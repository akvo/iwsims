import React, { useState } from 'react';
import { Text, Button, Input } from '@rneui/themed';
import Storage from 'expo-sqlite/kv-store';

import { CenterLayout, LogoImage } from '../components';
import { BuildParamsState, UIState } from '../store';
import { api, i18n } from '../lib';

const GetStarted = ({ navigation }) => {
  // eslint-disable-next-line global-require
  const [IPAddr, setIPAddr] = useState(null);
  const serverURLState = BuildParamsState.useState((s) => s.serverURL);
  const authenticationType = BuildParamsState.useState((s) => s.authenticationType);
  const activeLang = UIState.useState((s) => s.lang);
  const trans = i18n.text(activeLang);

  const goToLogin = async () => {
    if (IPAddr) {
      BuildParamsState.update((s) => {
        s.serverURL = IPAddr;
      });
      api.setServerURL(IPAddr);
      // save server URL
      await Storage.setItem('serverURL', IPAddr);
    }
    setTimeout(() => {
      if (authenticationType.includes('code_assignment')) {
        navigation.navigate('AuthForm');
        return;
      }
      navigation.navigate('AuthByPassForm');
    }, 100);
  };

  const titles = [trans.getStartedTitle1, trans.getStartedTitle2, trans.getStartedTitle3];
  return (
    <CenterLayout title={titles}>
      <LogoImage />
      <CenterLayout.Titles items={titles} />
      <Text>{trans.getStartedSubTitle}</Text>
      {!serverURLState && (
        <Input
          placeholder={trans.getStartedInputServer}
          onChangeText={setIPAddr}
          testID="server-url-field"
        />
      )}
      <Button title="primary" onPress={goToLogin} testID="get-started-button">
        {trans.buttonGetStarted}
      </Button>
    </CenterLayout>
  );
};

export default GetStarted;
