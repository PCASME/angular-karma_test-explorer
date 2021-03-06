import { TestSuiteInfo } from "vscode-test-adapter-api";
import { SpecToTestSuiteMapper } from "../../workers/test-explorer/spec-to-test-suite.mapper";
import { KarmaEvent } from "../../model/karma-event";
import { KarmaEventName } from "../../model/karma-event-name.enum";
import { TestState } from "../../model/test-state.enum";
import { Logger } from "../test-explorer/logger";
import { EventEmitter } from "../test-explorer/event-emitter";
import { commands } from "vscode";
import { TestResult } from "../../model/test-status.enum";

export class KarmaEventListener {

  public isServerLoaded: boolean = false;
  public isTestRunning: boolean = false;
  public lastRunTests: string = "";
  public testStatus: TestResult | any;
  public runCompleteEvent: KarmaEvent | any;
  private savedSpecs: any[] = [];
  private server: any;
  private karmaBeingReloaded: boolean = false;

  public constructor(private readonly logger: Logger, private readonly eventEmitter: EventEmitter) {
  }

  public listenTillKarmaReady(defaultSocketPort: number | undefined): Promise<void> {
    return new Promise<void>(resolve => {
      this.karmaBeingReloaded = false;
      const app = require("express")();
      this.server = require("http").createServer(app);
      const io = require("socket.io")(this.server, { pingInterval: 10, pingTimeout: 240000, forceNew: true });
      const port = defaultSocketPort !== 0 ? defaultSocketPort : 9999;

      io.on("connection", (socket: any) => {
        socket.on(KarmaEventName.BrowserConnected, () => {
          this.onBrowserConnected(resolve);
        });
        socket.on(KarmaEventName.BrowserError, (event: KarmaEvent) => {
          this.logger.info("browser_error " + event.results);
        });
        socket.on(KarmaEventName.BrowserStart, () => {
          this.savedSpecs = [];
        });
        socket.on(KarmaEventName.RunComplete, (event: KarmaEvent) => {
          this.runCompleteEvent = event;
        });
        socket.on(KarmaEventName.SpecComplete, (event: KarmaEvent) => {
          this.onSpecComplete(event);
        });

        socket.on("disconnect", (event: any) => {
          this.logger.info("AngularReporter closed connection with event: " + event);

          // workaround: if the connection is closed by chrome, we just reload the test enviroment
          // TODO: fix chrome closing all socket connections.
          if (event === "transport close" && !this.karmaBeingReloaded) {
            commands.executeCommand("test-explorer.reload");
          }
        });
      });

      this.server.listen(port, () => {
        this.logger.info("Listening to AngularReporter events on port " + port);
      });
    });
  }

  public getLoadedTests(): TestSuiteInfo[] {
    const specToTestSuiteMapper = new SpecToTestSuiteMapper();
    return specToTestSuiteMapper.map(this.savedSpecs);
  }

  public stopListeningToKarma() {
    this.isServerLoaded = false;
    this.karmaBeingReloaded = true;
    this.server.close();
  }

  private onSpecComplete(event: KarmaEvent) {
    const { results } = event;
    const { suite, description, status } = results;

    let testName = suite + " " + description;
    if (suite.length > 1) {
      testName = suite.join(" ") + " " + description;
    }

    if (testName.includes(this.lastRunTests) || this.lastRunTests === "") {
      this.eventEmitter.emitTestStateEvent(testName, TestState.Running);
      this.savedSpecs.push(results);

      this.eventEmitter.emitTestResultEvent(testName, event);

      if (this.lastRunTests !== "") {
        this.testStatus = status;
      }
    }
  }

  private onBrowserConnected(resolve: (value?: void | PromiseLike<void> | undefined) => void) {
    resolve();
    this.isServerLoaded = true;
  }
}
