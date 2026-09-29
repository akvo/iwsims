import React from 'react';
import { render, act } from '@testing-library/react-native';
import { UIState } from '../../store';
import StatusBanner from '../StatusBanner';
import { SYNC_STATUS } from '../../lib/constants';

describe('StatusBanner', () => {
  it('should render correctly when offline', () => {
    const { getByTestId } = render(<StatusBanner />);
    const textEl = getByTestId('offline-text');
    expect(textEl).toBeDefined();
    expect(textEl.props.children).toBe("You're offline...");
  });

  it('should render null when online', () => {
    const { queryByTestId } = render(<StatusBanner />);
    act(() => {
      UIState.update((s) => {
        s.online = true;
      });
    });
    const textEl = queryByTestId('offline-text');
    expect(textEl).toBeNull();
  });

  describe('incomplete datapoint sync', () => {
    const setState = (statusBar, lowStorage = false) =>
      act(() => {
        UIState.update((s) => {
          s.online = true;
          s.lowStorage = lowStorage;
          s.statusBar = statusBar;
        });
      });
    const incomplete = (done, total) => ({
      type: SYNC_STATUS.incomplete,
      bgColor: '#d97706',
      icon: 'alert-circle',
      done,
      total,
    });

    it('shows how many forms finished', () => {
      const { getByTestId } = render(<StatusBanner />);
      setState(incomplete(2, 5));
      expect(getByTestId('offline-text').props.children).toBe(
        'Download incomplete: 2 of 5 forms. Press Sync to resume.',
      );
    });

    it('drops the count when every form was fetched', () => {
      const { getByTestId } = render(<StatusBanner />);
      setState(incomplete(5, 5));
      expect(getByTestId('offline-text').props.children).toBe(
        'Download not finished. Press Sync to resume.',
      );
    });

    it('low storage wins over incomplete', () => {
      const { getByTestId } = render(<StatusBanner />);
      setState(incomplete(2, 5), true);
      expect(getByTestId('status-bar-low-storage')).toBeDefined();
    });
  });
});
