/* eslint-disable react/jsx-props-no-spreading */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Input } from '@rneui/themed';
import { FieldLabel } from '../support';
import styles from '../styles';
import { addPreffix, addSuffix } from './TypeInput';
import { strToFunction } from '../lib';

const TypeNumber = ({
  onChange,
  value,
  keyform,
  id,
  label,
  required,
  requiredSign = '*',
  disabled = false,
  addonAfter = null,
  addonBefore = null,
  tooltip = null,
  questions = [],
  fn = null,
  onFocus = null,
}) => {
  const [fieldColor, setFieldColor] = useState(null);
  const requiredValue = required ? requiredSign : null;
  const { fnColor } = fn || {};

  useEffect(() => {
    if (typeof fnColor === 'string') {
      try {
        const fnColorFunction = strToFunction(fnColor, { [id]: value }, questions);
        if (typeof fnColorFunction === 'function') {
          const fnColorValue = fnColorFunction();
          if (fnColorValue && fnColorValue !== fieldColor) {
            setFieldColor(fnColorValue);
          }
        }
      } catch {
        // Ignore errors in fnColor evaluation to avoid breaking the form
      }
    }
  }, [fnColor, fieldColor, id, value, questions, keyform]);

  const handleFocus = () => {
    if (onFocus) {
      onFocus();
    }
  };

  return (
    <View>
      <FieldLabel keyform={keyform} name={label} tooltip={tooltip} requiredSign={requiredValue} />
      <Input
        inputContainerStyle={{
          ...styles.inputFieldContainer,
          backgroundColor: fieldColor || 'white',
        }}
        style={{
          color: fieldColor ? 'white' : 'black',
        }}
        keyboardType="numeric"
        onChangeText={(val) => {
          if (onChange) {
            onChange(id, val);
          }
        }}
        onFocus={handleFocus}
        defaultValue={value === null || typeof value === 'undefined' ? '' : String(value)}
        value={value}
        testID="type-number"
        {...addPreffix(addonBefore)}
        {...addSuffix(addonAfter)}
        disabled={disabled}
      />
    </View>
  );
};

export default TypeNumber;
