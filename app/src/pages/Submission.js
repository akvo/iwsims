import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import LucideIcon from '@react-native-vector-icons/lucide';
import * as SQLite from 'expo-sqlite';
import moment from 'moment';
import * as Sentry from '@sentry/react-native';

import { FormState, UIState, UserState } from '../store';
import { i18n } from '../lib';
import { BaseLayout, FAButton } from '../components';
import { getCurrentTimestamp } from '../form/lib';

const Submission = ({ navigation, route }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(1);
  const [search, setSearch] = useState('');

  const previousForm = FormState.useState((s) => s.previousForm);
  const activeForm = FormState.useState((s) => s.form);
  const activeLang = UIState.useState((s) => s.lang);
  // const { id: activeUserId } = UserState.useState((s) => s);
  const trans = i18n.text(activeLang);
  // const db = SQLite.useSQLiteContext();

  const datapoints = useMemo(
    () =>
      data
        .map((res) => {
          const createdAt = moment(res.createdAt).format('DD/MM/YYYY hh:mm A');
          const syncedAt = res.syncedAt ? moment(res.syncedAt).format('DD/MM/YYYY hh:mm A') : '-';
          return {
            ...res,
            createdAt,
            syncedAt,
            isSynced: !!res.syncedAt,
          };
        })
        .filter((res) => {
          if (route?.params?.uuid) {
            return res.uuid === route.params.uuid;
          }
          return true;
        })
        .filter(
          (d) => (search && d?.name?.toLowerCase().includes(search.toLowerCase())) || !search,
        ),
    [data, search, route?.params?.uuid],
  );

  const goToNewForm = () => {
    FormState.update((s) => {
      s.surveyStart = getCurrentTimestamp();
      s.prevAdmAnswer = null;
    });
    navigation.push('FormPage', {
      ...route?.params,
      newSubmission: true,
    });
  };

  const goToDetails = (item) => {
    const { json: valuesJSON, name: dataPointName } = item;

    FormState.update((s) => {
      /**
       * Double parse to ensure that the JSON is correctly formatted
       * and to handle cases where the JSON string contains escaped quotes.
       */
      const jsonData = typeof valuesJSON === 'string' ? JSON.parse(valuesJSON) : valuesJSON;
      s.currentValues = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    });

    navigation.push('FormDataDetails', { name: dataPointName });
  };

  const goToFormOptions = (item) => {
    const { id, name, uuid, repeats } = item;
    if (repeats) {
      FormState.update((s) => {
        s.repeats = JSON.parse(repeats);
      });
    }
    navigation.push('FormOptions', {
      id,
      name,
      uuid,
      formId: activeForm.formId,
    });
  };

  const toggleIsSubmitted = () => {
    setTimeout(() => {
      setLoading(true);
      setSearch('');
      setIsSubmitted((prev) => (prev === 1 ? 0 : 1));
    }, 500);
  };

  const onClickItem = (selectedData) => {
    if (selectedData?.submitted === 0) {
      FormState.update((s) => {
        s.surveyStart = getCurrentTimestamp();
        s.surveyDuration = selectedData?.duration;
        s.repeats = selectedData?.repeats ? JSON.parse(selectedData?.repeats) : {};
      });
      navigation.navigate('FormPage', {
        ...route?.params,
        dataPointId: selectedData.id,
        newSubmission: false,
      });
      return;
    }
    if (activeForm?.parentId) {
      goToDetails(selectedData);
    } else {
      goToFormOptions(selectedData);
    }
  };

  // const fetchData = useCallback(async () => {
  //   const formStatement = await db.prepareAsync(
  //     'SELECT * FROM datapoints WHERE form = $form AND user = $user AND submitted = $submitted',
  //   );

  //   try {
  //     const result = await formStatement.executeAsync({
  //       $form: activeForm.id,
  //       $user: activeUserId,
  //       $submitted: isSubmitted,
  //     });
  //     const allRows = await result.getAllAsync();
  //     setData(allRows);
  //     // Reset the SQLite query cursor to the beginning for the next `getAllAsync()` call.
  //     await result.resetAsync();
  //   } catch (error) {
  //     Sentry.captureException(error, {
  //       extra: {
  //         page: 'Submission',
  //         activeForm,
  //         activeUserId,
  //         isSubmitted,
  //       },
  //     });
  //     // Optionally, you can show an error message to the user or log it to an error tracking service.
  //   } finally {
  //     await formStatement.finalizeAsync();
  //     setTimeout(() => {
  //       setLoading(false);
  //     }, 500);
  //   }
  // }, [db, activeForm, activeUserId, isSubmitted]);

  // useEffect(() => {
  //   fetchData();
  // }, [fetchData]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (previousForm) {
          FormState.update((s) => {
            s.form = previousForm;
            s.previousForm = null;
          });
        }
        navigation.dispatch(e.data.action);
      }),
    [navigation, previousForm],
  );

  const renderItem = ({ item }) => (
    <TouchableOpacity
      key={item.id}
      onPress={() => onClickItem(item)}
      testID={`submission-item-${item.id}`}
      style={[styles.itemContainer, item.submitted === 0 && styles.itemDraftBorder]}
      activeOpacity={0.6}
    >
      <View style={styles.iconContainer}>
        <Icon
          name={item.isSynced ? 'checkmark' : 'time'}
          size={24}
          color={item.isSynced ? '#4CAF50' : '#FFA000'}
        />
      </View>
      <View style={styles.itemContent}>
        <Text style={styles.itemTitle}>{item.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {item.submitted === 0 && (
            <View style={styles.draftBadge}>
              <Text style={styles.draftText}>{trans.draftText}</Text>
            </View>
          )}
          <Text style={styles.itemDate}>
            {trans.createdLabel} {item.createdAt}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () =>
    loading ? (
      <View style={styles.emptyStateContainer}>
        <View style={styles.emptyIconContainer}>
          <ActivityIndicator size="large" />
        </View>
        <View style={styles.emptyStateTextContainer}>
          <Text style={styles.emptyStateTitle}>{trans.fetchingData}</Text>
        </View>
      </View>
    ) : (
      <View style={styles.emptyStateContainer}>
        <View style={styles.emptyIconContainer}>
          <Icon name="document-outline" size={64} color="#C5CAE9" />
        </View>
        <View style={styles.emptyStateTextContainer}>
          <Text style={styles.emptyStateTitle}>{trans.emptySubmissionMessageInfo}</Text>
          <Text style={styles.emptyStateDescription}>{trans.emptySubmissionMessageAction}</Text>
        </View>
      </View>
    );

  return (
    <BaseLayout
      title={route?.params?.name}
      subTitle={route?.params?.subTitle}
      search={{
        show: true,
        value: search,
        action: setSearch,
      }}
      rightComponent={
        <TouchableOpacity
          onPress={toggleIsSubmitted}
          testID="draft-submission-button"
          style={{ padding: 8 }}
          activeOpacity={0.6}
          disabled={loading}
        >
          <View style={isSubmitted === 1 ? styles.redDot : styles.redDotHide} />
          {isSubmitted ? (
            <LucideIcon name="file-clock" size={24} color="#677483" />
          ) : (
            <Icon name="close-outline" size={24} color="#677483" />
          )}
        </TouchableOpacity>
      }
    >
      <BaseLayout.Content>
        <View style={styles.container}>
          <FlatList
            data={datapoints}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            testID="submission-list"
            contentContainerStyle={[
              styles.flatListContent,
              datapoints.length === 0 && styles.emptyListContent,
            ]}
            ListEmptyComponent={renderEmptyState}
          />
        </View>
      </BaseLayout.Content>
      <FAButton
        label={trans.newSubmissionText}
        onPress={goToNewForm}
        testID="new-submission-button"
        icon={{ name: 'add-circle', size: 20, color: 'white' }}
      />
    </BaseLayout>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  flatListContent: {
    padding: 8,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  itemContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'white',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
  },
  itemDraftBorder: {
    borderLeftColor: '#FFEB3B',
  },
  iconContainer: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 4,
  },
  itemDate: {
    fontSize: 12,
    color: '#9e9e9e',
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF0000',
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
  },
  redDotHide: {
    display: 'none',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyIconContainer: {
    marginBottom: 20,
  },
  emptyStateTextContainer: {
    alignItems: 'center',
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#424242',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: '#757575',
    textAlign: 'center',
    lineHeight: 20,
  },
  draftBadge: {
    backgroundColor: '#FFEB3B',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  draftText: {
    fontSize: 12,
    color: '#212121',
    fontWeight: 'bold',
  },
});

export default Submission;
