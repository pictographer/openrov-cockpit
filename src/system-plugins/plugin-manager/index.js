var logger;

var PREFERENCES = 'plugins:plugin-manager';

function pluginManager(name, deps) {
  logger = deps.logger;

  logger.info('Pugin Manager plugin started.');
  var preferences = getPreferences(deps.config);
  deps.app.get('/addons', function (req, res) {
    var view = __filename.substring(0, __filename.lastIndexOf('/')) + '/' + 'addonmanager.ejs';
    var pathInfo = deps.pathInfo();
    res.render(view, {
      title: 'ABB TXplore Addons',
      scripts: pathInfo.scripts,
      styles: pathInfo.styles,
      sysscripts: pathInfo.sysscripts,
      config: deps.config
    });
  });
}
function getPreferences(config) {
  var preferences = config.preferences.get(PREFERENCES);
  if (preferences === undefined) {
    preferences = {};
    config.preferences.set(PREFERENCES, preferences);
  }
  logger.debug('Plugin Manager loaded preferences: ' + JSON.stringify(preferences));
  return preferences;
}
module.exports = function (name, deps) {
  return new pluginManager(name, deps);
};
