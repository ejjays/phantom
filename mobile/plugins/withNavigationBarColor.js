const { withAndroidStyles, AndroidConfig } = require('@expo/config-plugins');

const withNavigationBarColor = (config) =>
  withAndroidStyles(config, (cfg) => {
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'android:navigationBarColor',
      value: '#080f28',
    });
    return cfg;
  });

module.exports = withNavigationBarColor;
