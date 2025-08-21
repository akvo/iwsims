import React, { Suspense, useCallback, useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import * as Location from 'expo-location';
import { SENTRY_DSN, SENTRY_ENV } from '@env';
import { SQLiteProvider } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import Navigation, { reactNavigationIntegration } from './src/navigation';
import { UIState, AuthState, UserState, BuildParamsState } from './src/store';
import { crudUsers, crudDataPoints } from './src/database/crud';
import { api } from './src/lib';
import { NetworkStatusBar, SyncService } from './src/components';
import { DATABASE_NAME, DATABASE_VERSION } from './src/lib/constants';
import { tables } from './src/database';
import sql from './src/database/sql';
import { m03 } from './src/database/migrations';

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
  const serverURLState = BuildParamsState.useState((s) => s.serverURL);
  const syncValue = BuildParamsState.useState((s) => s.dataSyncInterval);
  const gpsThresholdValue = BuildParamsState.useState((s) => s.gpsThreshold);
  const gpsAccuracyLevelValue = BuildParamsState.useState((s) => s.gpsAccuracyLevel);
  const geoLocationTimeoutValue = BuildParamsState.useState((s) => s.geoLocationTimeout);
  const appVersionValue = BuildParamsState.useState((s) => s.appVersion);
  const locationIsGranted = UserState.useState((s) => s.locationIsGranted);

  const handleInitConfig = async (db) => {
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

    /**
     * Check if there are new datapoints to save
     */
    const newDatapoints = await Storage.getItem('new_datapoints');
    const parsedItems = newDatapoints ? JSON.parse(newDatapoints) : [];

    if (parsedItems.length > 0) {
      parsedItems.forEach((item) => {
        crudDataPoints.saveDataPoint(db, item);
      });
      // Clear the storage after saving
      await Storage.removeItem('new_datapoints');
    }
  };

  const handleCheckSession = async (db) => {
    // check users exist
    const user = await crudUsers.getActiveUser(db);
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
  };

  const migrateDbIfNeeded = async (db) => {
    let { user_version: currentDbVersion } = await db.getFirstAsync('PRAGMA user_version');
    if (currentDbVersion >= DATABASE_VERSION) {
      await handleInitConfig(db);
      await handleCheckSession(db);
      return;
    }
    if (currentDbVersion === 0) {
      await db.execAsync(`PRAGMA journal_mode = 'wal';`);
      currentDbVersion = 1;
    }

    if (currentDbVersion === 1) {
      await Promise.all(
        tables.map(async (t) => {
          await sql.createTable(db, t.name, t.fields);
        }),
      );
      currentDbVersion = 2;
    }
    /**
     * This is the example of how to migrate the database
     * if you need to add a new column to the table, you can use the migration file
     * and add the migration function here.
     * For example:
     * if (currentDbVersion === 2) {
     *  await m03.up(db);
     *  currentDbVersion = 3;
     * }
     */
    if (currentDbVersion === 2) {
      await m03.up(db);
      currentDbVersion = 3;
    }
    // eslint-disable-next-line no-console
    console.info(`Migrating database from version ${currentDbVersion} to ${DATABASE_VERSION}`);
    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
  };

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

  return (
    <SafeAreaProvider>
      <Suspense fallback={null}>
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
          <Navigation />
          <NetworkStatusBar />
          <SyncService />
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
};

export default Sentry.wrap(App);
