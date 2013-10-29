/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var EXPORTED_SYMBOLS = ["slConfiguration"];

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import('resource://slimerjs/slErrorLogger.jsm');
Cu.import('resource://slimerjs/slUtils.jsm');
Cu.import("resource://gre/modules/Services.jsm");
Cu.import('resource://slimerjs/slDebug.jsm');

var defaultUA =  Cc["@mozilla.org/network/protocol;1?name=http"]
                      .getService(Ci.nsIHttpProtocolHandler)
                      .userAgent;
var availableProxyType = { 'auto':true, 'system':true, 'http':true, 'socks5':true,
                            'socks':true, 'none':true, 'config-url':true
                        }

var optionsSpec = {
    // name: [ 'cmdline option name', 'parser function name', 'default value',  supported],
    errorLogFile: ['error-log-file', 'file', '', true],
    cookiesFile : ['cookies-file', 'file', '', false],
    diskCacheEnabled : ['disk-cache', 'bool', false, true],
    maxDiskCacheSize : ['max-disk-cache-size', 'int', -1, true],
    ignoreSslErrors : ['ignore-ssl-errors', 'bool', false, false],
    loadImages: ['load-images', 'bool', true, true],
    localToRemoteUrlAccessEnabled : ['local-to-remote-url-access', 'bool', false, false],
    outputEncoding : ['output-encoding', 'encoding', 'UTF-8', false],
    proxyType : ['proxy-type', 'proxytype', 'http', true],
    proxy : ['proxy', 'proxy', null, true],
    proxyHost : ['', '', '', false],
    proxyPort : ['', '', 1080, false],
    proxyAuth : ['proxy-auth', 'proxyauth', null, false],
    proxyAuthUser : ['', '', '', false],
    proxyAuthPassword : ['', '', '', false],
    scriptEncoding : ['script-encoding', 'encoding', 'UTF-8', false],
    webSecurityEnabled : ['web-security', 'bool', true, false],
    offlineStoragePath : ['local-storage-path', 'file', '', false],
    offlineStorageDefaultQuota : ['local-storage-quota', 'int', -1, true],
    printDebugMessages : ['debug', 'debug', false, true],
    javascriptCanOpenWindows : ['', '', true, false],
    javascriptCanCloseWindows : ['', '', true, false],
    remoteDebuggerPort : ['remote-debugger-port', 'int', -1, false],
    remoteDebuggerAutorun : ['remote-debugger-autorun', 'bool', false, false],
    sslCertificatesPath : ['ssl-certificates-path', 'path', '', false]
};

var slConfiguration = {

    /**
     * list of script arguments
     */
    args : [],

    /**
     * The URI of the main script. It can be a file://, chrome:// or resource:// URI
     * @var nsIURI
     */
    mainScriptURI : null,

    /**
     * If the script URI is a file:// URI, this is the corresponding nsIFile object
     * @var nsIFile
     */
    scriptFile: null,

    /**
     * If the script is a chrome/resource URI, this is the "module path" for the mapping
     * of the module loader.
     * @var string
     */
    scriptModulePath: null,

    /**
     * The directory from where SlimerJS has been launched
     * @var nsIFile
     */
    workingDirectory: null,

    setEnvNames : function(envvars) {
        this.envs = envvars.filter(function(element, index, array) {
            return /^[a-z0-9_]+$/i.test(element);
        });
    },

    /**
     * list of environment variable name
     */
    envs : [],

    handleFlags : function(cmdline, scriptHandlers) {
        scriptHandlers.forEach(function(sh){
            sh.setOptionsSpecInto(optionsSpec);
        })

        for (let opt in optionsSpec) {

            let [ cmdlineOpt, parser, defaultValue, supported] = optionsSpec[opt];
            if (cmdlineOpt == '')
                continue;
            let optValue;
            try {
                if (typeof cmdlineOpt == "string") {
                    optValue = cmdline.handleFlagWithParam(cmdlineOpt, false);
                }
                else {
                    // this is an array
                    cmdlineOpt.some(function(cmdname) {
                        optValue = cmdline.handleFlagWithParam(cmdname, false);
                        if (optValue) {
                            return true;
                        }
                        return false;
                    });
                }
            }
            catch(e) {
                throw new Error("Error: missing value for flag --"+cmdlineOpt)
            }

            if (optValue) {
                if (!supported) {
                    dump("--"+cmdlineOpt+" not supported yet\n");
                    continue;
                }
                if (parser) {
                    if (typeof parser == 'string') {
                        this[opt] = this['parse_'+parser](optValue, cmdlineOpt);
                    }
                    else
                        this[opt] = parser(optValue, cmdlineOpt);
                }
                else
                    this[opt] = optValue;
            }
            else
                this[opt] = defaultValue;
        }

        let configFile = cmdline.handleFlagWithParam("config", false);
        if (configFile) {
            this.handleConfigFile(configFile);
        }

        if (this.errorLogFile) {
            initErrorLogger(this.errorLogFile, this.workingDirectory);
        }

        let profd = Services.dirsvc.get("ProfD", Ci.nsIFile);
        profd.append("webappsstore.sqlite");
        this.offlineStoragePath = profd.path;

        if (this.offlineStorageDefaultQuota === null || this.offlineStorageDefaultQuota === -1) {
            optionsSpec.offlineStorageDefaultQuota[2] = this.offlineStorageDefaultQuota
                                                      = Services.prefs.getIntPref("dom.storage.default_quota") * 1024;
        }
        else {
            Services.prefs.setIntPref("dom.storage.default_quota", Math.ceil(this.offlineStorageDefaultQuota /1024));
        }

        Services.prefs.setBoolPref('browser.cache.disk.enable', this.diskCacheEnabled);
        if (this.maxDiskCacheSize > -1)
            Services.prefs.setIntPref('browser.cache.disk.capacity', this.maxDiskCacheSize);

        switch (this.proxyType) {
            case 'auto':
                Services.prefs.setIntPref('network.proxy.type',4);
                break;
            case 'system':
                Services.prefs.setIntPref('network.proxy.type',5);
                break;
            case 'http':
                if (this.proxyHost) {
                    Services.prefs.setCharPref('network.proxy.http', this.proxyHost)
                    Services.prefs.setIntPref('network.proxy.http_port', this.proxyPort);
                    Services.prefs.setIntPref('network.proxy.type',1);
                }
                else {
                    Services.prefs.setIntPref('network.proxy.type',0);
                }
                break;
            case 'socks5':
            case 'socks':
                if (this.proxyHost) {
                    Services.prefs.setCharPref('network.proxy.socks', this.proxyHost)
                    Services.prefs.setIntPref('network.proxy.socks_port', this.proxyPort);
                    Services.prefs.setIntPref('network.proxy.type',1);
                }
                else {
                    Services.prefs.setIntPref('network.proxy.type',0);
                }
                break;
            case 'config-url':
                if (this.proxy.startsWith('http://') || this.proxy.startsWith('file://')) {
                    Services.prefs.setIntPref('network.proxy.type',2);
                    Services.prefs.setCharPref('network.proxy.autoconfig_url', this.proxy)
                }
                break;
            case '':
                if (this.proxy != '') {
                    Services.prefs.setCharPref('network.proxy.http', this.proxyHost)
                    Services.prefs.setIntPref('network.proxy.http_port', this.proxyPort);
                    Services.prefs.setIntPref('network.proxy.type',1);
                    break;
                }
            default:
                Services.prefs.setIntPref('network.proxy.type',0);
        }
    },

    parse_int : function (val, cmdlineOpt) {
        return parseInt(val);
    },

    parse_bool : function (val, cmdlineOpt) {
        if (val === 'true' || val === 'yes' || val === true) {
            return true;
        }
        if (val === 'false' || val === 'no' || val === false) {
            return false;
        }
        throw new Error("Invalid value for '"+cmdlineOpt+"' option. It should be yes or no");
    },

    parse_file : function (val, cmdlineOpt) {
        // @TODO check if file exists ?
        return val;
    },

    parse_encoding : function (val, cmdlineOpt) {
        return val;
    },

    parse_proxytype : function (val, cmdlineOpt) {
        if (val != "" && !(val in availableProxyType)) {
            throw new Error("Invalid value for '"+cmdlineOpt+"' option. It should be auto, system, http, socksv5, none or config-url");
        }
        if (val == 'none')
            return '';
        return val;
    },

    parse_proxyauth : function (val, cmdlineOpt) {
        let pos = val.lastIndexOf(':')
        if ( pos > 0) {
            [this.proxyAuthUser, this.proxyAuthPassword] = val.split(":");
        }
        else
            this.proxyAuthUser = val
        return val;
    },

    parse_proxy : function (val, cmdlineOpt) {
        let pos = val.lastIndexOf(':')
        if ( pos > 0) {
            [this.proxyHost, this.proxyPort] = val.split(":");
        }
        else {
            this.proxyHost = val;
            this.proxyPort = 80;
        }
        return val;
    },

    parse_path : function (val, cmdlineOpt) {
        return val;
    },

    parse_url : function (val, cmdlineOpt) {
        return val;
    },

    parse_debug : function (val, cmdlineOpt) {
       let parsedVal;
        try {
            parsedVal = this.parse_bool(val, cmdlineOpt);
            slDebugInit(parsedVal);
        }
        catch(e) {
            parsedVal = slDebugInit(val);
        }
        return val;
    },

    handleConfigFile: function(fileName) {
        let file = slUtils.getMozFile(fileName, this.workingDirectory);
        let fileContent = slUtils.readSyncStringFromFile(file);
        let config;
        try {
            config = JSON.parse(fileContent);
        }
        catch(e) {
            throw new Error ("Config file content is not a valid JSON content");
        }
        if (typeof config != 'object')
            throw new Error ("The config file does not contain a JSON object");


        for (let opt in config) {
            if (! (opt in optionsSpec)) {
                throw new Error ("Unknow option "+opt+" in the config file");
            }
            let [ cmdlineOpt, parser, defaultValue, supported] = optionsSpec[opt];
            if (cmdlineOpt == '') {
                throw new Error ("Unknow option "+opt+" in the config file");
            }

            let optValue = config[opt];
            if (optValue) {
                if (!supported) {
                    dump("Option "+opt+" in the config file, not supported yet\n");
                    continue;
                }
                if (parser) {
                    if (typeof parser == 'string') {
                        this[opt] = this['parse_'+parser](optValue, cmdlineOpt);
                    }
                    else
                        this[opt] = parser(optValue, cmdlineOpt);
                }
                else
                    this[opt] = optValue;
            }
        }
    },

    getDefaultWebpageConfig : function() {
        
        return Object.freeze({
            javascriptEnabled: true,
            loadImages: this.loadImages,
            localToRemoteUrlAccessEnabled: this.localToRemoteUrlAccessEnabled,
            XSSAuditingEnabled : false,
            webSecurityEnabled: this.webSecurityEnabled,
            javascriptCanOpenWindows: this.javascriptCanOpenWindows,
            javascriptCanCloseWindows: this.javascriptCanCloseWindows,
            userAgent: defaultUA,
            userName: undefined,
            password: undefined,
            maxAuthAttempts: undefined,
            resourceTimeout: undefined,
            plainTextAllContent: false
        })
    },

    printDebugConfig : function() {
        for (let opt in optionsSpec) {
            let [ cmdlineOpt, parser, defaultValue, supported] = optionsSpec[opt];
            if (cmdlineOpt == '' || !supported)
                continue;
            if (this[opt] != defaultValue){
                slDebugLog('Configuration: '+cmdlineOpt+'='+this[opt]);
            }
        }
        if (this.scriptFile)
            slDebugLog('Configuration: Script='+this.scriptFile.path);
        else if (this.mainScriptURI)
            slDebugLog('Configuration: Script='+this.mainScriptURI.spec);
        else
            slDebugLog('Configuration: Script=unknown??');

        if (this.workingDirectory)
            slDebugLog('Configuration: workingDirectory='+this.workingDirectory.path);
        else
            slDebugLog('Configuration: workingDirectory=unknown??');
    },

    errorLogFile : '',
    cookiesFile : '',
    diskCacheEnabled : true,
    maxDiskCacheSize : null,
    ignoreSslErrors : false,
    loadImages: true,
    localToRemoteUrlAccessEnabled : false,
    outputEncoding : 'UTF-8',
    proxyType : null,
    proxy : null,
    proxyHost:null,
    proxyPort:null,
    proxyAuth : null,
    proxyAuthUser : null,
    proxyAuthPassword : null,
    scriptEncoding : 'UTF-8',
    webSecurityEnabled : true,
    offlineStoragePath : null,
    offlineStorageDefaultQuota : null,
    printDebugMessages : false,
    javascriptCanOpenWindows : true,
    javascriptCanCloseWindows : true,
    sslCertificatesPath : null,
    enableCoffeeScript: true
}

