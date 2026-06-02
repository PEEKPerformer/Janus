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
      backgroundColor: "#000000"
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
        backgroundColor: "#000000"
      }
    },
    web: {
      bundler: "metro",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
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
        "expo-alternate-app-icons",
        [
          {
            "name": "cerberus",
            "ios": "./assets/images/custom_icons/cerberus.png",
            "android": {
              "foregroundImage": "./assets/images/custom_icons/cerberus.png",
              "backgroundColor": "#FFFFFF",
            },
          },
          {
            "name": "hail_hydra",
            "ios": "./assets/images/custom_icons/hail_hydra.png",
            "android": {
              "foregroundImage": "./assets/images/custom_icons/hail_hydra.png",
              "backgroundColor": "#FFFFFF",
            },
          },
          {
            "name": "hail_hydra_dark",
            "ios": "./assets/images/custom_icons/hail_hydra_dark.png",
            "android": {
              "foregroundImage": "./assets/images/custom_icons/hail_hydra_dark.png",
              "backgroundColor": "#000000",
            },
          },
        ]
      ],
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
      "expo-secure-store",
      "expo-sqlite",
      "expo-video",
      "expo-web-browser",
    ],
  }
}
