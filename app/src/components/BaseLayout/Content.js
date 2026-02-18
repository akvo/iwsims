import React from 'react';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import Card from '../Card';
import Stack from '../Stack';

const Content = ({ children = null, data = [], columns = 1, action = null }) => {
  if (data?.length) {
    return (
      <ScrollView style={{ width: '100%' }} contentContainerStyle={{ flexGrow: 1 }}>
        <Stack row columns={columns}>
          {data?.map((d) =>
            action ? (
              <TouchableOpacity
                key={d?.id}
                type="clear"
                onPress={() => action(d?.id)}
                testID={`card-touchable-${d?.id}`}
                style={{ width: '100%' }}
              >
                <Card title={d?.name} subTitles={d?.subtitles} />
              </TouchableOpacity>
            ) : (
              <View key={d?.id} testID={`card-non-touchable-${d?.id}`} style={{ width: '100%' }}>
                <Card title={d?.name} subTitles={d?.subtitles} />
              </View>
            ),
          )}
        </Stack>
      </ScrollView>
    );
  }
  return <View style={{ flex: 1, width: '100%' }}>{children}</View>;
};

export default Content;
