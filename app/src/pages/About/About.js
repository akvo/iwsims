import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Icon, Dialog, Button } from '@rneui/themed';
import { BaseLayout } from '../../components';
import { BuildParamsState, UIState } from '../../store';
import { i18n } from '../../lib';
import useVersionCheck from '../../hooks/use-version-check';

const AboutHome = () => {
  const { appVersion, apkName } = BuildParamsState.useState((s) => s);
  const isOnline = UIState.useState((s) => s.online);
  const { lang } = UIState.useState((s) => s);
  const trans = i18n.text(lang);
  const { visible, setVisible, checking, updateInfo, checkVersion, handleUpdate } =
    useVersionCheck();

  return (
    <BaseLayout title={trans.about} rightComponent={false}>
      <BaseLayout.Content>
        <View>
          {/* About App Info */}
          <View style={styles.listItem}>
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>{`${trans.about} ${apkName}`}</Text>
              <Text style={styles.listItemSubtitle}>{trans.aboutAppDescription}</Text>
            </View>
          </View>

          {/* App Version */}
          <View style={styles.listItem}>
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>{trans.appVersionLabel}</Text>
              <Text style={styles.listItemSubtitle}>{appVersion}</Text>
            </View>
          </View>

          {/* Update button */}
          <Button
            title={trans.updateApp}
            onPress={checkVersion}
            icon={<Icon name="system-update" type="materialicon" color="#fff" />}
            buttonStyle={styles.updateButton}
            titleStyle={styles.updateButtonText}
            testID="update-button"
            disabled={!isOnline}
          />
          {/* EOL Update button */}

          <Dialog isVisible={visible}>
            {checking ? (
              <View>
                <Dialog.Loading />
                <Text style={{ textAlign: 'center' }}>{trans.checkingVersion}</Text>
              </View>
            ) : (
              <View>
                <Text>{updateInfo.text}</Text>
                <Dialog.Actions>
                  {updateInfo.status === 200 ? (
                    <Dialog.Button onPress={handleUpdate}>{trans.buttonUpdate}</Dialog.Button>
                  ) : (
                    ''
                  )}
                  <Dialog.Button onPress={() => setVisible(false)}>
                    {trans.buttonCancel}
                  </Dialog.Button>
                </Dialog.Actions>
              </View>
            )}
          </Dialog>
        </View>
      </BaseLayout.Content>
    </BaseLayout>
  );
};

const styles = StyleSheet.create({
  listItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  listItemContent: {
    flexDirection: 'column',
  },
  listItemTitle: {
    fontWeight: 'bold',
  },
  listItemSubtitle: {
    color: '#666',
    paddingTop: 14,
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007bff',
    borderRadius: 5,
    marginVertical: 16,
    marginHorizontal: 10,
  },
  updateButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginRight: 10,
  },
});

export default AboutHome;
