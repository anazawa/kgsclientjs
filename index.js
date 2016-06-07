(function () {
    "use strict";

    var XMLHttpRequest;

    var kgsPoller = function () {
        var that = kgsPoller.eventEmitter(); 

        that.initialize = (function (superInitialize) {
            return function (args) {
                superInitialize.apply(that, arguments);
                args = args || {};
                this._keepPolling = false;
                this._isLoggedIn = false;
                this._url = args.url || "http://metakgs.org/api/access";
                this._logger = args.logger || kgsPoller.nullLogger();
            };
        }(that.initialize));

        that.url = function (value) {
            return this._url;
        };

        that.logger = function (value) {
            if (arguments.length) {
                this._logger = value;
                return this;
            }
            return this._logger;
        };

        that.isLoggedIn = function () {
            return this._isLoggedIn;
        };

        that._createXMLHttpRequest = function (config) {
            var xhr = new XMLHttpRequest();
                xhr.open(config.method, config.url, true);
                xhr.withCredentials = true;
                xhr.config = config;

            Object.keys(config.headers || {}).forEach(function (key) {
                xhr.setRequestHeader(key, config.headers[key]);
            });

            var that = this;
            xhr.onerror = function () {
                that.emit("error", kgsPoller.error.connectionError(xhr, args));
                that._keepPolling = false;
            };

            return xhr;
        };

        that.send = function (message, onSuccess, onError) {
            if (message.type === "LOGIN" && this._isLoggedIn) {
                throw kgsPoller.error.alreadyLoggedInError();
            }
            if (message.type !== "LOGIN" && !this._isLoggedIn) {
                throw kgsPoller.error.notLoggedInError();
            }

            this.logger().debug("-> "+message.type+":", message);

            var xhr = this._createXMLHttpRequest({
                method: "POST",
                url: this.url(),
                headers: {
                    "Content-Type": "application/json; charset=UTF-8"
                },
                data: message
            });

            var that = this;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    if (!that._keepPolling) {
                        that.logger().info("Start polling "+that.url());
                        that._keepPolling = true;
                        that._isLoggedIn = false;
                        that._poll();
                    }
                    onSuccess(xhr);
                }
                else {
                    xhr.onerror.call(null);
                }
            };
            xhr.onerror = function () {
                that._keepPolling = false;
                onError(xhr);
            };

            xhr.send(JSON.stringify(message));
        };

        that._poll = function () {
            var xhr = this._createXMLHttpRequest({
                method: "GET",
                url: this.url()
            });

            var that = this;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    var messages = JSON.parse(xhr.response).messages || [];
                    messages.forEach(function (message) {
                        if (message.type === "LOGIN_SUCCESS") {
                            that._keepPolling = true;
                            that._isLoggedIn = true;
                        }
                        else if (/^LOGIN_FAILED/.test(message.type)) {
                            that._keepPolling = true;
                            that._isLoggedIn = false;
                        }
                        else if (message.type === "LOGOUT") {
                            that.logger().info("Stop polling");
                            that._keepPolling = false;
                            that._isLoggedIn = false;
                        }
                    });
                    messages.forEach(function (message) {
                        that.logger().debug("<- "+message.type+":", message);
                        that.emit("message", message);
                        that.emit(message.type, message);
                    });
                    if (that._keepPolling) {
                        that.logger().debug("Keep polling");
                        that._poll();
                    }
                }
                else {
                    xhr.onerror.call(null);
                }
            };
            xhr.onerror = function () {
                that.emit("error", kgsPoller.error.connectionError(xhr));
                that._keepPolling = false;
            };

            xhr.send(null);
        };

        return that.create.apply(that, arguments);
    };

    kgsPoller.eventEmitter = function () {
        var that = {};

        that.create = function () {
            var other = Object.create(this);
            other.initialize.apply(other, arguments);
            return other;
        };

        that.initialize = function () {
            this._listeners = {};
        };

        that.eventNames = function () {
            return Object.keys(this._listeners);
        };

        that.on = function (event) {
            this._listeners[event] = this._listeners[event] || [];
            if (arguments.length > 1) {
                for (var i = 1; i < arguments.length; i++) {
                    this._listeners[event].push(arguments[i]);
                }
                return this;
            }
            return this._listeners[event].slice(0);
        };

        that.off = function (arg1, arg2) {
            if (arg1 && arg2) {
                if (this._listeners[arg1]) {
                    var index = this._listeners[arg1].indexOf(arg2);
                    if (index !== -1) {
                        this._listeners[arg1].splice(index, 1);
                    }
                }
            }
            else if (typeof arg1 === "function") {
                this.eventNames().forEach(function (event) {
                    this.off(event, arg1);
                }, this);
            }
            else if (typeof arg1 === "string") {
                this._listeners[arg1] = [];
            }
            else {
                this._listeners = {};
            }
            return this;
        };

        that.once = function (event, listener) {
            this.on(event, function self() {
                listener.apply(this, arguments);
                this.off(self);
            });
            return this;
        };

        that.emit = function (event) {
            var args = Array.prototype.slice.call(arguments, 1);
            var listeners = this.on(event);

            if (event === "error" && !listeners.length) {
                throw args[0];
            }

            listeners.forEach(function (listener) {
                try {
                    listener.apply(this, args);
                }
                catch (error) {
                    if (event === "error") {
                        throw error;
                    }
                    this.emit("error", error);
                }
            }, this);

            return listeners.length;
        };

        return that.create.apply(that, arguments);;
    };

    kgsPoller.nullLogger = function () {
        return {
            error: function () {},
            warn: function () {},
            info: function () {},
            log: function () {},
            debug: function () {}
        };
    };

    kgsPoller.error = function (that) {
        that = that || {};

        that.toString = function () {
            return this.message ? this.type+": "+this.message : this.type;
        };

        return that;
    };

    kgsPoller.error.connectionError = function (xhr) {
        return kgsPoller.error({
            type: "kgsPollerConnectionError",
            message: xhr.status ? xhr.status+" "+xhr.statusText : "",
            xhr: xhr
        });
    };

    kgsPoller.error.notLoggedInError = function () {
        return kgsPoller.error({
            type: "kgsPollerNotLoggedInError",
            message: "You have to log in first"
        });
    };

    kgsPoller.error.alreadyLoggedInError = function () {
        return kgsPoller.error({
            type: "kgsPollerAlreadyLoggedInError",
            message: "You are already logged in"
        });
    };

    if (typeof exports !== "undefined") {
        XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
        module.exports = kgsPoller;
    }
    else {
        XMLHttpRequest = window.XMLHttpRequest;
        window.kgsPoller = kgsPoller;
    }

}());

