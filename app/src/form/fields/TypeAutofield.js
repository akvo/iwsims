import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Input } from '@rneui/themed';

import { FieldLabel } from '../support';
import styles from '../styles';
import { FormState } from '../../store';
import { strToFunction } from '../lib';

const TypeAutofield = ({
  keyform,
  id,
  label,
  fn,
  tooltip = null,
  displayOnly = false,
  questions = [],
  value: autofieldValue = null,
}) => {
  const [value, setValue] = useState(null);
  const [fieldColor, setFieldColor] = useState(null);
  const { fnString: nameFnString, fnColor } = fn;

  useEffect(() => {
    const unsubsValues = FormState.subscribe(({ currentValues, surveyStart }) => {
      if (!surveyStart) {
        /**
         * When the survey session ends, `fnString` will not be re-executed.
         * */
        return;
      }
      try {
        // Pass the original fnString and allQuestions to strToFunction
        const automateValue = strToFunction(nameFnString, currentValues, questions);
        if (typeof automateValue === 'function') {
          const answer = automateValue();
          if (answer !== value && (answer || answer === 0)) {
            setValue(answer);

            // Handle fnColor - supports both string-based function and object lookup
            if (typeof fnColor === 'string') {
              // Use the original fnColor string with allQuestions
              const fnColorFunction = strToFunction(fnColor, currentValues, questions);
              if (typeof fnColorFunction === 'function') {
                const fnColorValue = fnColorFunction();
                if (fnColorValue && fnColorValue !== fieldColor) {
                  setFieldColor(fnColorValue);
                }
              }
            } else if (typeof fnColor === 'object' && fnColor?.[answer]) {
              setFieldColor(fnColor[answer]);
            } else {
              setFieldColor(null);
            }
          }
        }
      } catch {
        // Ignore errors in fnString evaluation to avoid breaking the form
      }
    });

    return () => {
      unsubsValues();
    };
  }, [fnColor, nameFnString, id, value, fieldColor, questions]);

  useEffect(() => {
    if (value !== null && value !== autofieldValue && !displayOnly) {
      FormState.update((s) => {
        s.currentValues[id] = value;
      });
    }
  }, [value, id, autofieldValue, displayOnly]);

  return (
    <View testID="type-autofield-wrapper">
      <FieldLabel keyform={keyform} name={label} tooltip={tooltip} />
      <Input
        inputContainerStyle={{
          ...styles.autoFieldContainer,
          backgroundColor: fieldColor || styles.autoFieldContainer.backgroundColor,
        }}
        value={value || value === 0 ? String(value) : null}
        testID="type-autofield"
        multiline
        numberOfLines={2}
        disabled
        style={{
          fontWeight: 'bold',
          opacity: 1,
          color: fieldColor ? 'white' : 'black',
        }}
      />
    </View>
  );
};

export default TypeAutofield;
