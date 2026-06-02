// This replaces `const { getDefaultConfig } = require('expo/metro-config');`
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// This replaces `const config = getDefaultConfig(__dirname);`
const config = getSentryExpoConfig(__dirname);

config.resolver.sourceExts.push('sql');

// Janus keeps read-only reference clones (Hydra/Voyager), the dependency spike,
// and design docs inside the repo. Those dirs contain their own RN/web projects
// and node_modules, which would otherwise collide with Metro's Haste map
// (duplicate package names, duplicate react-native, etc.). Exclude them.
// Modern Metro accepts a RegExp[] for blockList directly.
config.resolver.blockList = [
  /.*\/\.reference\/.*/,
  /.*\/\.spike\/.*/,
  /.*\/\.design\/.*/,
];

module.exports = config;
