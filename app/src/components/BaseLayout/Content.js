import React from 'react';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import Card from '../Card';
import Stack from '../Stack';

const Content = ({
  children = null,
  data = [],
  columns = 1,
  action = null,
  syncingFormId = null,
  formProgress = {},
}) => {
  if (data?.length) {
    return (
      <ScrollView style={{ width: '100%' }} contentContainerStyle={{ flexGrow: 1 }}>
        <Stack row columns={columns}>
          {data?.map((d) => {
            const cardFormId = d?.formId ? Number(d.formId) : null;
            const isSyncing = syncingFormId != null && cardFormId === Number(syncingFormId);
            const progress = cardFormId ? formProgress[cardFormId] : null;
            const syncPercent =
              isSyncing && progress?.total > 0 ? (progress.processed / progress.total) * 100 : 0;

            return action ? (
              <TouchableOpacity
                key={d?.id}
                type="clear"
                onPress={() => action(d?.id)}
                testID={`card-touchable-${d?.id}`}
                style={{ width: '100%' }}
              >
                <Card
                  title={d?.name}
                  subTitles={d?.subtitles}
                  syncing={isSyncing}
                  syncProgress={syncPercent}
                />
              </TouchableOpacity>
            ) : (
              <View key={d?.id} testID={`card-non-touchable-${d?.id}`} style={{ width: '100%' }}>
                <Card
                  title={d?.name}
                  subTitles={d?.subtitles}
                  syncing={isSyncing}
                  syncProgress={syncPercent}
                />
              </View>
            );
          })}
        </Stack>
      </ScrollView>
    );
  }
  return <View style={{ flex: 1, width: '100%' }}>{children}</View>;
};

export default Content;
