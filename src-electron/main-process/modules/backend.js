import { Daemon } from "./daemon";
import { WalletRPC } from "./wallet-rpc";
import { SCEE } from "./SCEE-Node";
import { dialog } from "electron";
import semver from "semver";
import axios from "axios";
import { version } from "../../../package.json";
const bunyan = require("bunyan");

const WebSocket = require("ws");
const electron = require("electron");
const os = require("os");
const fs = require("fs-extra");
const path = require("upath");
const objectAssignDeep = require("object-assign-deep");

const { ipcMain: ipc } = electron;

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"];

export class Backend {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.daemon = null;
    this.walletd = null;
    this.wss = null;
    this.token = null;
    this.config_dir = null;
    this.wallet_dir = null;
    this.config_file = null;
    this.config_data = {};
    this.scee = new SCEE();
    this.log = null;
  }

  init(config) {
    let configDir;
    let legacyLokiConfigDir;
    if (os.platform() === "win32") {
      configDir = "C:\\ProgramData\\oxen";
      legacyLokiConfigDir = "C:\\ProgramData\\loki\\";
      this.wallet_dir = `${os.homedir()}\\Documents\\Oxen`;
    } else {
      configDir = path.join(os.homedir(), ".oxen");
      legacyLokiConfigDir = path.join(os.homedir(), ".loki/");
      this.wallet_dir = path.join(os.homedir(), "Oxen");
    }

    // if the user has used loki before, just keep the same stuff
    if (fs.existsSync(legacyLokiConfigDir)) {
      this.config_dir = legacyLokiConfigDir;
    } else {
      // create the new, Oxen location
      this.config_dir = configDir;
      if (!fs.existsSync(configDir)) {
        fs.mkdirpSync(configDir);
      }
    }

    if (!fs.existsSync(path.join(this.config_dir, "gui"))) {
      fs.mkdirpSync(path.join(this.config_dir, "gui"));
    }

    this.config_file = path.join(this.config_dir, "gui", "config.json");

    const daemon = {
      type: "remote",
      p2p_bind_ip: "0.0.0.0",
      p2p_bind_port: 22022,
      rpc_bind_ip: "127.0.0.1",
      rpc_bind_port: 22023,
      zmq_rpc_bind_ip: "127.0.0.1",
      out_peers: -1,
      in_peers: -1,
      limit_rate_up: -1,
      limit_rate_down: -1,
      log_level: 0
    };

    const daemons = {
      mainnet: {
        ...daemon,
        remote_host: "imaginary.stream",
        remote_port: 22023
      },
      stagenet: {
        ...daemon,
        type: "local",
        p2p_bind_port: 38153,
        rpc_bind_port: 38154
      },
      testnet: {
        ...daemon,
        type: "local",
        p2p_bind_port: 38156,
        rpc_bind_port: 38157
      }
    };

    // Default values
    this.defaults = {
      daemons: objectAssignDeep({}, daemons),
      app: {
        data_dir: this.config_dir,
        wallet_data_dir: this.wallet_dir,
        ws_bind_port: 12313,
        net_type: "mainnet"
      },
      wallet: {
        rpc_bind_port: 22026,
        log_level: 0
      }
    };

    this.config_data = {
      // Copy all the properties of defaults
      ...objectAssignDeep({}, this.defaults),
      appearance: {
        theme: "dark"
      }
    };

    this.remotes = [
      {
        host: "public-na.optf.ngo",
        port: "22023"
      },
      {
        host: "explorer.oxen.aussie-pools.com",
        port: "18081"
      },
      {
        host: "public-eu.optf.ngo",
        port: "22023"
      }
    ];

    this.token = config.token;

    this.wss = new WebSocket.Server({
      port: config.port,
      maxPayload: Number.POSITIVE_INFINITY
    });

    this.wss.on("connection", ws => {
      ws.on("message", data => this.receive(data));
    });
  }

  send(event, data = {}) {
    let message = {
      event,
      data
    };

    let encrypted_data = this.scee.encryptString(
      JSON.stringify(message),
      this.token
    );

    this.wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(encrypted_data);
      }
    });
  }

  receive(data) {
    let decrypted_data = JSON.parse(this.scee.decryptString(data, this.token));

    // route incoming request to either the daemon, wallet, or here
    switch (decrypted_data.module) {
      case "core":
        this.handle(decrypted_data);
        break;
      case "daemon":
        if (this.daemon) {
          this.daemon.handle(decrypted_data);
        }
        break;
      case "wallet":
        if (this.walletd) {
          this.walletd.handle(decrypted_data);
        }
        break;
    }
  }

  handle(data) {
    let params = data.data;

    // check if config has changed
    let config_changed = false;

    switch (data.method) {
      case "set_language":
        this.send("set_language", { lang: params.lang });
        break;
      case "quick_save_config":
        // save only partial config settings
        Object.keys(params).map(key => {
          this.config_data[key] = Object.assign(
            this.config_data[key],
            params[key]
          );
        });
        fs.writeFile(
          this.config_file,
          JSON.stringify(this.config_data, null, 4),
          "utf8",
          () => {
            this.send("set_app_data", {
              config: params,
              pending_config: params
            });
          }
        );
        break;
      case "save_config_init":
      case "save_config": {
        if (data.method === "save_config") {
          Object.keys(this.config_data).map(i => {
            if (i == "appearance") return;
            Object.keys(this.config_data[i]).map(j => {
              if (this.config_data[i][j] !== params[i][j]) {
                config_changed = true;
              }
            });
          });
        }

        Object.keys(params).map(key => {
          this.config_data[key] = Object.assign(
            this.config_data[key],
            params[key]
          );
        });

        const validated = Object.keys(this.defaults)
          .filter(k => k in this.config_data)
          .map(k => [
            k,
            this.validate_values(this.config_data[k], this.defaults[k])
          ])
          .reduce((map, obj) => {
            map[obj[0]] = obj[1];
            return map;
          }, {});

        // Validate daemon data
        this.config_data = {
          ...this.config_data,
          ...validated
        };

        fs.writeFile(
          this.config_file,
          JSON.stringify(this.config_data, null, 4),
          "utf8",
          () => {
            if (data.method == "save_config_init") {
              this.startup();
            } else {
              this.send("set_app_data", {
                config: this.config_data,
                pending_config: this.config_data
              });
              if (config_changed) {
                this.send("settings_changed_reboot");
              }
            }
          }
        );
        break;
      }
      case "init":
        this.startup();
        break;

      case "open_explorer": {
        const { net_type } = this.config_data.app;

        let path = null;
        if (params.type === "tx") {
          path = "tx";
        } else if (params.type === "service_node") {
          path = "sn";
        }

        if (path) {
          const baseUrl =
            net_type === "testnet"
              ? "https://testnet.oxen.observer"
              : "https://oxen.observer";
          const url = `${baseUrl}/${path}/`;
          require("electron").shell.openExternal(url + params.id);
        }
        break;
      }

      case "open_url":
        require("electron").shell.openExternal(params.url);
        break;

      case "save_png": {
        let filename = dialog.showSaveDialog(this.mainWindow, {
          title: "Save " + params.type,
          filters: [{ name: "PNG", extensions: ["png"] }],
          defaultPath: os.homedir()
        });
        if (filename) {
          let base64Data = params.img.replace(/^data:image\/png;base64,/, "");
          let binaryData = Buffer.from(base64Data, "base64").toString("binary");
          fs.writeFile(filename, binaryData, "binary", err => {
            if (err) {
              this.send("show_notification", {
                type: "negative",
                i18n: [
                  "notification.errors.errorSavingItem",
                  { item: params.type }
                ],
                timeout: 2000
              });
            } else {
              this.send("show_notification", {
                i18n: [
                  "notification.positive.itemSaved",
                  { item: params.type, filename }
                ],
                timeout: 2000
              });
            }
          });
        }
        break;
      }

      default:
        break;
    }
  }
  // if the version is a whole minor version out of date (hardfork out of date)
  // set update required to true
  async checkVersion() {
    try {
      const { data } = await axios.get(
        "https://api.github.com/repos/loki-project/loki-electron-gui-wallet/releases/latest"
      );
      // remove the 'v' from front of the version
      const latestVersion = data.tag_name.substring(1);
      // can return "major", "minor", "patch"
      const vSizeDiff = semver.diff(version, latestVersion);
      const updateAvailable = semver.ltr(version, latestVersion);
      const majorOrMinor = vSizeDiff === "major" || vSizeDiff == "minor";
      const updateRequired = updateAvailable && majorOrMinor;
      this.send("set_update_required", updateRequired);
    } catch (e) {
      this.send("set_updated_required", false);
    }
  }

  initLogger(logPath) {
    let log = bunyan.createLogger({
      name: "log",
      streams: [
        {
          type: "rotating-file",
          path: path.join(logPath, "electron.log"),
          period: "1d", // daily rotation
          count: 4 // keep 4 days of logs
        }
      ]
    });

    LOG_LEVELS.forEach(level => {
      ipc.on(`log-${level}`, (first, ...rest) => {
        log[level](...rest);
      });
    });

    this.log = log;

    process.on("uncaughtException", error => {
      log.error("Unhandled Error", error);
    });

    process.on("unhandledRejection", error => {
      log.error("Unhandled Promise Rejection", error);
    });
  }

  startup() {
    this.send("set_app_data", {
      remotes: this.remotes,
      defaults: this.defaults
    });

    this.checkVersion();

    fs.readFile(this.config_file, "utf8", (err, data) => {
      if (err) {
        this.send("set_app_data", {
          status: {
            code: -1 // Config not found
          },
          config: this.config_data,
          pending_config: this.config_data
        });
        return;
      }

      let disk_config_data = JSON.parse(data);

      // semi-shallow object merge
      Object.keys(disk_config_data).map(key => {
        if (!this.config_data.hasOwnProperty(key)) {
          this.config_data[key] = {};
        }
        this.config_data[key] = Object.assign(
          this.config_data[key],
          disk_config_data[key]
        );
      });

      // here we may want to check if config data is valid, if not also send code -1
      // i.e. check ports are integers and > 1024, check that data dir path exists, etc
      const validated = Object.keys(this.defaults)
        .filter(k => k in this.config_data)
        .map(k => [
          k,
          this.validate_values(this.config_data[k], this.defaults[k])
        ])
        .reduce((map, obj) => {
          map[obj[0]] = obj[1];
          return map;
        }, {});

      // Make sure the daemon data is valid
      this.config_data = {
        ...this.config_data,
        ...validated
      };

      // save config file back to file, so updated options are stored on disk
      fs.writeFile(
        this.config_file,
        JSON.stringify(this.config_data, null, 4),
        "utf8",
        () => {}
      );

      this.send("set_app_data", {
        config: this.config_data,
        pending_config: this.config_data
      });

      // Make the wallet dir
      const { wallet_data_dir, data_dir } = this.config_data.app;
      if (!fs.existsSync(wallet_data_dir)) {
        fs.mkdirpSync(wallet_data_dir);
      }

      // Check to see if data and wallet directories exist
      const dirs_to_check = [
        {
          path: data_dir,
          error: "notification.errors.dataPathNotFound"
        },
        {
          path: wallet_data_dir,
          error: "notification.errors.walletPathNotFound"
        }
      ];

      for (const dir of dirs_to_check) {
        // Check to see if dir exists
        if (!fs.existsSync(dir.path)) {
          this.send("show_notification", {
            type: "negative",
            i18n: dir.error,
            timeout: 2000
          });

          // Go back to config
          this.send("set_app_data", {
            status: {
              code: -1 // Return to config screen
            }
          });
          return;
        }
      }

      const { net_type } = this.config_data.app;

      const dirs = {
        mainnet: this.config_data.app.data_dir,
        stagenet: path.join(this.config_data.app.data_dir, "stagenet"),
        testnet: path.join(this.config_data.app.data_dir, "testnet")
      };

      // Make sure we have the directories we need
      const net_dir = dirs[net_type];
      if (!fs.existsSync(net_dir)) {
        fs.mkdirpSync(net_dir);
      }

      const log_dir = path.join(net_dir, "logs");
      if (!fs.existsSync(log_dir)) {
        fs.mkdirpSync(log_dir);
      }

      this.initLogger(log_dir);

      this.daemon = new Daemon(this);
      this.walletd = new WalletRPC(this);

      this.send("set_app_data", {
        status: {
          code: 3 // Starting daemon
        }
      });

      // Make sure the remote node provided is accessible
      const config_daemon = this.config_data.daemons[net_type];
      this.daemon.checkRemote(config_daemon).then(data => {
        if (data.error) {
          // If we can default to local then we do so, otherwise we tell the user  to re-set the node
          if (config_daemon.type === "local_remote") {
            this.config_data.daemons[net_type].type = "local";
            this.send("set_app_data", {
              config: this.config_data,
              pending_config: this.config_data
            });
            this.send("show_notification", {
              type: "warning",
              textColor: "black",
              i18n: "notification.warnings.usingLocalNode",
              timeout: 2000
            });
          } else {
            this.send("show_notification", {
              type: "negative",
              i18n: "notification.errors.cannotAccessRemoteNode",
              timeout: 2000
            });

            // Go back to config
            this.send("set_app_data", {
              status: {
                code: -1 // Return to config screen
              }
            });
            return;
          }
        }

        // If we got a net type back then check if ours match
        if (data.net_type && data.net_type !== net_type) {
          this.send("show_notification", {
            type: "negative",
            i18n: "notification.errors.differentNetType",
            timeout: 2000
          });

          // Go back to config
          this.send("set_app_data", {
            status: {
              code: -1 // Return to config screen
            }
          });
          return;
        }

        this.daemon
          .checkVersion()
          .then(version => {
            if (version) {
              this.send("set_app_data", {
                status: {
                  code: 4,
                  message: version
                }
              });
            } else {
              // daemon not found, probably removed by AV, set to remote node
              this.config_data.daemons[net_type].type = "remote";
              this.send("set_app_data", {
                status: {
                  code: 5
                },
                config: this.config_data,
                pending_config: this.config_data
              });
            }

            this.daemon
              .start(this.config_data)
              .then(() => {
                this.send("set_app_data", {
                  status: {
                    code: 6 // Starting wallet
                  }
                });

                this.walletd
                  .start(this.config_data)
                  .then(() => {
                    this.send("set_app_data", {
                      status: {
                        code: 7 // Reading wallet list
                      }
                    });

                    this.walletd.listWallets(true);

                    this.send("set_app_data", {
                      status: {
                        code: 0 // Ready
                      }
                    });
                    // eslint-disable-next-line
                  })
                  .catch(error => {
                    this.daemon.killProcess();
                    this.send("show_notification", {
                      type: "negative",
                      message: error.message,
                      timeout: 3000
                    });
                    this.send("set_app_data", {
                      status: {
                        code: -1 // Return to config screen
                      }
                    });
                  });
                // eslint-disable-next-line
              })
              .catch(error => {
                if (this.config_data.daemons[net_type].type == "remote") {
                  this.send("show_notification", {
                    type: "negative",
                    i18n: "notification.errors.remoteCannotBeReached",
                    timeout: 3000
                  });
                } else {
                  this.send("show_notification", {
                    type: "negative",
                    message: error.message,
                    timeout: 3000
                  });
                }
                this.send("set_app_data", {
                  status: {
                    code: -1 // Return to config screen
                  }
                });
              });
            // eslint-disable-next-line
          })
          .catch(() => {
            this.send("set_app_data", {
              status: {
                code: -1 // Return to config screen
              }
            });
          });
      });
    });
  }

  quit() {
    return new Promise(resolve => {
      let process = [];
      if (this.daemon) {
        process.push(this.daemon.quit());
      }
      if (this.walletd) {
        process.push(this.walletd.quit());
      }
      if (this.wss) {
        this.wss.close();
      }

      Promise.all(process).then(() => {
        resolve();
      });
    });
  }

  // Replace any invalid value with default values
  validate_values(values, defaults) {
    const isDictionary = v =>
      typeof v === "object" &&
      v !== null &&
      !(v instanceof Array) &&
      !(v instanceof Date);
    const modified = { ...values };

    // Make sure we have valid defaults
    if (!isDictionary(defaults)) return modified;

    for (const key in modified) {
      // Only modify if we have a default
      if (!(key in defaults)) continue;

      const defaultValue = defaults[key];
      const invalidDefault =
        defaultValue === null ||
        defaultValue === undefined ||
        Number.isNaN(defaultValue);
      if (invalidDefault) continue;

      const value = modified[key];

      // If we have a object then recurse through it
      if (isDictionary(value)) {
        modified[key] = this.validate_values(value, defaultValue);
      } else {
        // Check if we need to replace the value
        const isValidValue = !(
          value === undefined ||
          value === null ||
          value === "" ||
          Number.isNaN(value)
        );
        if (isValidValue) continue;

        // Otherwise set the default value
        modified[key] = defaultValue;
      }
    }
    return modified;
  }
}
