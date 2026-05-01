import { useState, useEffect, useCallback, useRef } from 'react';
import { Linking, Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { BuildParamsState, UIState } from '../store';
import { api, i18n } from '../lib';

const useVersionCheck = ({ autoCheck = false } = {}) => {
  const { appVersion, apkURL } = BuildParamsState.useState((s) => s);
  const isOnline = UIState.useState((s) => s.online);
  const { lang } = UIState.useState((s) => s);
  const trans = i18n.text(lang);

  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState({ status: null, text: '' });
  const hasChecked = useRef(false);

  const checkVersion = useCallback(
    (silent = false) => {
      if (!isOnline) {
        return;
      }
      setChecking(true);
      if (!silent) {
        setVisible(true);
      }
      api
        .get(`/apk/version/${appVersion}`)
        .then((res) => {
          setUpdateInfo({
            status: 200,
            text: `${trans.newVersionAvailable} (v ${res.data.version})`,
          });
          if (silent) {
            setVisible(true);
          }
        })
        .catch((e) => {
          setUpdateInfo({ status: e?.response?.status || 500, text: trans.noUpdateFound });
          if (e?.response?.status !== 404) {
            Sentry.captureMessage('[VersionCheck] Unable to fetch app version');
            Sentry.captureException(e);
          }
        })
        .finally(() => {
          setChecking(false);
        });
    },
    [appVersion, isOnline, trans.newVersionAvailable, trans.noUpdateFound],
  );

  const handleUpdate = useCallback(async () => {
    if (!apkURL) {
      Sentry.captureMessage('[VersionCheck] apkURL is missing — cannot open update');
      Alert.alert('Update URL is not configured. Please contact support.');
      return;
    }
    const supported = await Linking.canOpenURL(apkURL);
    if (supported) {
      await Linking.openURL(apkURL);
    } else {
      Alert.alert(`Don't know how to open this URL: ${apkURL}`);
    }
  }, [apkURL]);

  useEffect(() => {
    if (!autoCheck || hasChecked.current) {
      return;
    }
    // One-shot per mount: lock the gate even when offline so a late
    // online-flip cannot trigger a delayed force-update dialog mid-session.
    hasChecked.current = true;
    if (isOnline) {
      checkVersion(true);
    }
  }, [autoCheck, isOnline, checkVersion]);

  return { visible, setVisible, checking, updateInfo, checkVersion, handleUpdate };
};

export default useVersionCheck;
