/* eslint-disable no-console */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Platform,
  ToastAndroid,
  BackHandler,
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Dialog, Text } from '@rneui/themed';
import Icon from 'react-native-vector-icons/Ionicons';
import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import * as Crypto from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';
import FormContainer from '../form/FormContainer';
import { SaveDialogMenu, SaveDropdownMenu } from '../form/support';
import { BaseLayout } from '../components';
import { crudDataPoints } from '../database/crud';
import { UserState, UIState, FormState } from '../store';
import { generateDataPointName, getDurationInMinutes, transformAnswers } from '../form/lib';
import { i18n } from '../lib';
import { QUESTION_TYPES } from '../lib/constants';

const FormPage = ({ navigation, route }) => {
  const selectedForm = FormState.useState((s) => s.form);
  const surveyDuration = FormState.useState((s) => s.surveyDuration);
  const surveyStart = FormState.useState((s) => s.surveyStart);
  const currentValues = FormState.useState((s) => s.currentValues);
  const cascades = FormState.useState((s) => s.cascades);
  const repeats = FormState.useState((s) => s.repeats);
  const userId = UserState.useState((s) => s.id);
  const [showDialogMenu, setShowDialogMenu] = useState(false);
  const [showDropdownMenu, setShowDropdownMenu] = useState(false);
  const [showExitConfirmationDialog, setShowExitConfirmationDialog] = useState(false);
  const activeLang = UIState.useState((s) => s.lang);
  const trans = i18n.text(activeLang);

  const currentFormId = route?.params?.id;
  // continue saved submission
  const savedDataPointId = route?.params?.dataPointId;
  const isNewSubmission = route?.params?.newSubmission;
  const [currentDataPoint, setCurrentDataPoint] = useState({});
  const [loading, setLoading] = useState(false);
  const db = SQLite.useSQLiteContext();

  const formJSON = useMemo(() => {
    if (!selectedForm?.json) {
      return {};
    }
    return JSON.parse(selectedForm.json);
  }, [selectedForm]);

  const refreshForm = useCallback(() => {
    /**
     * Close connection for all cascade SQLite
     */
    const { cascades: cascadesFiles } = formJSON || {};
    cascadesFiles?.forEach((csFile) => {
      const [dbFile] = csFile?.split('/')?.slice(-1) || [];
      const connDB = SQLite.openDatabaseSync(dbFile);
      connDB.closeAsync();
    });

    FormState.update((s) => {
      s.surveyStart = null;
      s.currentValues = {};
      s.visitedQuestionGroup = [];
      s.cascades = {};
      s.surveyDuration = 0;
      s.repeats = {};
    });
  }, [formJSON]);

  const handleOnPressArrowBackButton = () => {
    if (Object.keys(currentValues).length) {
      setShowDialogMenu(true);
      return;
    }
    refreshForm();
    navigation.goBack();
  };

  const handleOnSaveAndExit = async () => {
    const { dpName, dpGeo } = generateDataPointName(formJSON, currentValues, cascades);
    const jsonAnswers = transformAnswers(currentValues, formJSON);
    const saveData = {
      form: currentFormId,
      user: userId,
      name: dpName || trans.untitled,
      submitted: 0,
      duration: surveyDuration,
      json: jsonAnswers,
      uuid: route.params?.uuid || Crypto.randomUUID(),
      geo: dpGeo,
    };

    const duration = getDurationInMinutes(surveyStart) + surveyDuration;
    const payload = {
      ...currentDataPoint,
      ...saveData,
      duration: duration === 0 ? 1 : duration,
      repeats: Object.keys(repeats).length ? JSON.stringify(repeats) : null,
      syncedAt: null,
    };
    try {
      if (isNewSubmission) {
        await crudDataPoints.saveDataPoint(db, payload);
      } else {
        await crudDataPoints.updateDataPoint(db, payload);
      }
      if (Platform.OS === 'android') {
        ToastAndroid.show(trans.successSaveDatapoint, ToastAndroid.LONG);
      }
      refreshForm();
      navigation.navigate('Home', { ...route?.params });
    } catch (error) {
      Sentry.captureMessage('[FormPage] Cannot save draft submissions');
      Sentry.captureException(error);
      const newItems = await Storage.getItem('new_datapoints');
      const parsedItems = newItems ? JSON.parse(newItems) : [];
      await Storage.setItem('new_datapoints', JSON.stringify([...parsedItems, payload]));
      refreshForm();
      navigation.navigate('Home', { ...route?.params });
    }
  };

  const handleShowExitConfirmationDialog = () => {
    setShowDropdownMenu(false);
    setShowDialogMenu(false);
    setShowExitConfirmationDialog(true);
  };

  const handleOnExit = () => {
    refreshForm();
    return navigation.navigate('Home');
  };

  const handleOnSubmitForm = async (values) => {
    const answers = transformAnswers(values.answers, formJSON);

    const datapoitName = values?.name || trans.untitled;
    const submitData = {
      form: currentFormId,
      user: userId,
      name: datapoitName,
      geo: values.geo,
      submitted: 1,
      duration: surveyDuration,
      json: answers,
      uuid: route.params?.uuid || Crypto.randomUUID(),
    };
    const duration = getDurationInMinutes(surveyStart) + surveyDuration;
    const payload = {
      ...currentDataPoint,
      ...submitData,
      duration: duration === 0 ? 1 : duration,
      syncedAt: null,
    };
    try {
      if (isNewSubmission) {
        await crudDataPoints.saveDataPoint(db, payload);
      } else {
        await crudDataPoints.updateDataPoint(db, payload);
      }

      if (Platform.OS === 'android') {
        ToastAndroid.show(trans.successSubmitted, ToastAndroid.LONG);
      }
      refreshForm();
      navigation.navigate('Home', { ...route?.params });
    } catch (error) {
      Sentry.captureMessage('[FormPage] Cannot submit submissions');
      Sentry.captureException(error);
      const newItems = await Storage.getItem('new_datapoints');
      const parsedItems = newItems ? JSON.parse(newItems) : [];
      await Storage.setItem('new_datapoints', JSON.stringify([...parsedItems, payload]));
      refreshForm();
      navigation.navigate('Home', { ...route?.params });
    }
  };

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Object.keys(currentValues).length) {
        setShowDialogMenu(true);
        return true;
      }
      refreshForm();
      return false;
    });
    return () => backHandler.remove();
  }, [currentValues, refreshForm]);

  const fetchSavedSubmission = useCallback(async () => {
    if (!savedDataPointId) {
      return;
    }
    setLoading(true);
    const dpValue = await crudDataPoints.selectDataPointById(db, { id: savedDataPointId });
    setCurrentDataPoint(dpValue);
    const jsonData = dpValue?.json;
    if (jsonData && Object.keys(jsonData).length) {
      let prevAdmAnswer = [];
      // Process cascade questions
      (formJSON?.question_group || [])
        .flatMap((qg) => qg.question)
        .filter((q) => q.type === QUESTION_TYPES.cascade)
        .forEach((q) => {
          const val = jsonData[q.id];
          if (q?.source?.file === 'administrator.sqlite' && val) {
            prevAdmAnswer = Array.isArray(val) ? val : [val];
          }
          if (val && !Array.isArray(val)) {
            jsonData[q.id] = [val];
          }
        });
      FormState.update((s) => {
        s.currentValues = jsonData;
        s.prevAdmAnswer = prevAdmAnswer;
      });
    }
    setLoading(false);
  }, [db, savedDataPointId, formJSON]);

  useEffect(() => {
    fetchSavedSubmission();
  }, [fetchSavedSubmission]);

  return (
    <BaseLayout
      title={route?.params?.name}
      subTitle="formPage"
      leftComponent={
        <Button type="clear" onPress={handleOnPressArrowBackButton} testID="arrow-back-button">
          <Icon name="arrow-back" size={18} />
        </Button>
      }
      rightComponent={
        <SaveDropdownMenu
          visible={showDropdownMenu}
          setVisible={setShowDropdownMenu}
          anchor={
            <Button
              type="clear"
              testID="form-page-kebab-menu"
              onPress={() => setShowDropdownMenu(true)}
            >
              <Icon name="ellipsis-vertical" size={18} />
            </Button>
          }
          handleOnExit={handleShowExitConfirmationDialog}
          handleOnSaveAndExit={handleOnSaveAndExit}
        />
      }
    >
      {!loading ? (
        <FormContainer
          forms={formJSON}
          onSubmit={handleOnSubmitForm}
          setShowDialogMenu={setShowDialogMenu}
          db={db}
          isNewSubmission={isNewSubmission}
        />
      ) : (
        <View style={styles.loadingContainer}>
          <ActivityIndicator />
        </View>
      )}
      <SaveDialogMenu
        visible={showDialogMenu}
        setVisible={setShowDialogMenu}
        handleOnExit={handleShowExitConfirmationDialog}
        handleOnSaveAndExit={handleOnSaveAndExit}
      />
      <Dialog visible={showExitConfirmationDialog} testID="exit-confirmation-dialog">
        <Text testID="exit-confirmation-text">{trans.confirmExit}</Text>
        <Dialog.Actions>
          <Dialog.Button
            title={trans.buttonExit}
            onPress={handleOnExit}
            testID="exit-confirmation-ok"
          />
          <Dialog.Button
            title={trans.buttonCancel}
            onPress={() => setShowExitConfirmationDialog(false)}
            testID="exit-confirmation-cancel"
          />
        </Dialog.Actions>
      </Dialog>
    </BaseLayout>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
  },
});

export default FormPage;
