import React from 'react';
import { SearchBar } from '@rneui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import PageTitle from './PageTitle';
import Content from './Content';
import { UIState } from '../../store';

const BaseLayout = ({
  children,
  title = null,
  subTitle = null,
  search = { placeholder: null, show: false, value: null, action: null },
  leftComponent = null,
  leftContainerStyle = {},
  rightComponent = null,
  rightContainerStyle = {},
}) => {
  const isOnline = UIState.useState((s) => s.online);
  const statusBar = UIState.useState((s) => s.statusBar);
  const networkBarVisible = !isOnline || statusBar !== null;
  const edges = networkBarVisible ? ['left', 'right'] : ['left', 'right', 'bottom'];

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: '#f9fafb',
      }}
      edges={edges}
    >
      {title && (
        <PageTitle
          text={title}
          subTitle={subTitle}
          {...{ leftComponent, leftContainerStyle, rightComponent, rightContainerStyle }}
        />
      )}
      {search.show && (
        <SearchBar
          placeholder={search.placeholder}
          value={search.value}
          onChangeText={search.action}
          testID="search-bar"
          containerStyle={{ width: '100%' }}
        />
      )}
      {children}
    </SafeAreaView>
  );
};

BaseLayout.Content = Content;

export default BaseLayout;
