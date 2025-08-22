const { getDefaultConfig } = require('expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const defaultConfig = getDefaultConfig(__dirname);
const sentryConfig = getSentryExpoConfig(__dirname);

const mergedConfig = {
  ...defaultConfig,
  ...sentryConfig,
  resolver: {
    ...defaultConfig.resolver,
    ...sentryConfig.resolver,
    assetExts: [...defaultConfig.resolver.assetExts, 'db'],
    sourceExts: [...defaultConfig.resolver.sourceExts, 'sql'],
  },
};

module.exports = mergedConfig;
