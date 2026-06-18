module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo',
    ],
    plugins: [
      [
        'inline-import',
        {
          extensions: ['.sql'],
        }
      ],
      // Reanimated 4: the worklets plugin rewrites `'worklet'`-tagged functions
      // to run on the UI thread. MUST stay last in the plugin list.
      'react-native-worklets/plugin',
    ],
  };
};
