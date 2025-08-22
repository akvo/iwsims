import React, { Suspense, useCallback, useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import * as Location from 'expo-location';
import { SENTRY_DSN, SENTRY_ENV } from '@env';
import Storage from 'expo-sqlite/kv-store';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import Navigation, { reactNavigationIntegration } from './src/navigation';
import { UIState, AuthState, UserState, BuildParamsState } from './src/store';
import { api } from './src/lib';
import { NetworkStatusBar, SyncService } from './src/components';
import migrations from './drizzle/migrations';
import db from './src/db';

export const setNotificationHandler = () =>
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

setNotificationHandler();

Sentry.init({
  dsn: SENTRY_DSN,
  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for performance monitoring.
  // We recommend adjusting this value in production
  tracesSampleRate: 1.0,
  enableInExpoDevelopment: true,
  // If `true`, Sentry will try to print out useful debugging information if something goes wrong with sending the event.
  // Set it to `false` in production
  environment: SENTRY_ENV,
  debug: false,
  enableAppStartTracking: true,
  enableNativeFramesTracking: true,
  enableStallTracking: true,
  enableUserInteractionTracing: true,
  integrations: [reactNavigationIntegration],
});

const App = () => {
  const { success, error } = useMigrations(db, migrations);
  const serverURLState = BuildParamsState.useState((s) => s.serverURL);
  const syncValue = BuildParamsState.useState((s) => s.dataSyncInterval);
  const gpsThresholdValue = BuildParamsState.useState((s) => s.gpsThreshold);
  const gpsAccuracyLevelValue = BuildParamsState.useState((s) => s.gpsAccuracyLevel);
  const geoLocationTimeoutValue = BuildParamsState.useState((s) => s.geoLocationTimeout);
  const appVersionValue = BuildParamsState.useState((s) => s.appVersion);
  const locationIsGranted = UserState.useState((s) => s.locationIsGranted);

  const handleInitConfig = useCallback(async () => {
    /**
     * Server URL
     */
    const serverURL = await Storage.getItem('serverURL');
    if (!serverURL) {
      await Storage.setItem('serverURL', serverURLState);
      api.setServerURL(serverURLState);
    } else {
      BuildParamsState.update((s) => {
        s.serverURL = serverURL;
      });
      api.setServerURL(serverURL);
    }
    /**
     * App Version
     */
    const appVersion = await Storage.getItem('appVersion');
    if (!appVersion) {
      await Storage.setItem('appVersion', appVersionValue);
    } else {
      BuildParamsState.update((s) => {
        s.appVersion = appVersion;
      });
    }
    /**
     * Sync Interval
     */
    const syncInterval = await Storage.getItem('syncInterval');
    if (!syncInterval) {
      await Storage.setItem('syncInterval', `${syncValue}`);
    } else {
      BuildParamsState.update((s) => {
        s.dataSyncInterval = parseInt(syncInterval, 10);
      });
    }
    /**
     * GPS Threshold
     */
    const gpsThreshold = await Storage.getItem('gpsThreshold');
    if (!gpsThreshold) {
      await Storage.setItem('gpsThreshold', `${gpsThresholdValue}`);
    } else {
      BuildParamsState.update((s) => {
        s.gpsThreshold = parseInt(gpsThreshold, 10);
      });
    }
    /**
     * GPS Accuracy Level
     */
    const gpsAccuracyLevel = await Storage.getItem('gpsAccuracyLevel');
    if (!gpsAccuracyLevel) {
      await Storage.setItem('gpsAccuracyLevel', `${gpsAccuracyLevelValue}`);
    } else {
      BuildParamsState.update((s) => {
        s.gpsAccuracyLevel = parseInt(gpsAccuracyLevel, 10);
      });
    }

    /**
     * Geo Location Timeout
     */
    const geoLocationTimeout = await Storage.getItem('geoLocationTimeout');
    if (!geoLocationTimeout) {
      await Storage.setItem('geoLocationTimeout', `${geoLocationTimeoutValue}`);
    } else {
      BuildParamsState.update((s) => {
        s.geoLocationTimeout = parseInt(geoLocationTimeout, 10);
      });
    }

    const userState = await Storage.getItem('activeUser');
    const user = userState ? JSON.parse(userState) : null;
    if (!user) {
      UIState.update((s) => {
        s.currentPage = 'GetStarted';
      });
      return;
    }
    if (user.token) {
      api.setToken(user.token);
      UserState.update((s) => {
        s.id = user.id;
        s.name = user.name;
        s.password = user.password;
      });
      AuthState.update((s) => {
        s.token = user.token;
        s.authenticationCode = user.password;
      });
      UIState.update((s) => {
        s.currentPage = 'Home';
      });
    }
    if (!success) {
      console.error('Database migration failed:', error);
    }
    if (error) {
      console.error('Database migration error:', error);
    }
    // /**
    //  * Check if there are new datapoints to save
    //  */
    // const newDatapoints = await Storage.getItem('new_datapoints');
    // const parsedItems = newDatapoints ? JSON.parse(newDatapoints) : [];

    // if (parsedItems.length > 0) {
    //   parsedItems.forEach((item) => {
    //     crudDataPoints.saveDataPoint(db, item);
    //   });
    //   // Clear the storage after saving
    //   await Storage.removeItem('new_datapoints');
    // }
  }, [
    serverURLState,
    syncValue,
    gpsThresholdValue,
    gpsAccuracyLevelValue,
    geoLocationTimeoutValue,
    appVersionValue,
    error,
    success,
  ]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      UIState.update((s) => {
        s.online = state.isConnected;
        s.networkType = state.type?.toUpperCase();
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const requestAccessLocation = useCallback(async () => {
    if (locationIsGranted) {
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      UserState.update((s) => {
        s.locationIsGranted = true;
      });
    }
  }, [locationIsGranted]);

  useEffect(() => {
    requestAccessLocation();
  }, [requestAccessLocation]);

  useEffect(() => {
    handleInitConfig();
  }, [handleInitConfig]);

  return (
    <SafeAreaProvider>
      <Suspense fallback={null}>
        <Navigation />
        <NetworkStatusBar />
        {/* <SyncService /> */}
      </Suspense>
    </SafeAreaProvider>
  );
};

export default Sentry.wrap(App);
