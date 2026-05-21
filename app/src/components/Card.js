/* eslint-disable react/no-array-index-key */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card as RneCard, Text } from '@rneui/themed';

const Card = ({ title = null, subTitles = [], syncing = false, syncProgress = 0 }) => (
  <RneCard containerStyle={[styles.container, syncing && styles.syncingContainer]}>
    {title && <RneCard.Title style={styles.title}>{title}</RneCard.Title>}
    {subTitles?.map((s, sx) => (
      <Text key={sx}>{s}</Text>
    ))}
    {syncing && (
      <View style={styles.progressBarContainer} testID="sync-progress-bar">
        <View
          style={[
            styles.progressBarFill,
            { width: `${Math.min(Math.max(syncProgress, 0), 100)}%` },
          ]}
        />
      </View>
    )}
  </RneCard>
);

const styles = StyleSheet.create({
  container: {
    width: '100%',
    margin: 0,
  },
  syncingContainer: {
    borderColor: '#2563eb',
    borderWidth: 1,
  },
  title: {
    textAlign: 'left',
    width: '100%',
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 2,
  },
});

export default Card;
