import packageJson from './package.json';

const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = {
  expo: {
    name: "Janus",
    slug: "janus",
    version: packageJson.version,
    runtimeVersion: {
      policy: 'appVersion',
    },
    icon: "./assets/images/icon.png",
    scheme: "janus",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/images/splash.png",
      resizeMode: "contain",
      backgroundColor: "#140f2b"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.janus.client",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.janus.client",
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#140f2b"
      }
    },
    web: {
      bundler: "metro",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      [
        'expo-media-library', {
          savePhotosPermission: 'Allow $(PRODUCT_NAME) to save photos and videos to your library.',
        }
      ],
      "@sentry/react-native/expo",
      [
        'expo-image-picker', {
          "photosPermission": "$(PRODUCT_NAME) accesses your photos to upload images.",
        }
      ],
      "expo-notifications",
      [
        "expo-sharing",
        {
          "ios": {
            "enabled": true,
            "activationRule": {
              "supportsWebUrlWithMaxCount": 1,
            }
          },
        }
      ],
      [
        "expo-screen-orientation",
        {
          "initialOrientation": "DEFAULT"
        }
      ],
      "expo-font",
      "expo-image",
      "onnxruntime-react-native",
      "expo-secure-store",
      "expo-sqlite",
      "expo-video",
      "expo-web-browser",
    ],
  }
}
