import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { BaseLayout } from '../components';
import { FormNavigation, QuestionGroupList } from './support';
import QuestionGroup from './components/QuestionGroup';
import { transformForm, generateDataPointName } from './lib';
import { FormState } from '../store';
import { crudDataPoints, crudForms } from '../database/crud';

// TODO:: Allow other not supported yet

const checkValuesBeforeCallback = ({ values }) =>
  Object.keys(values)
    .filter((key) => {
      // EOL remove value where question is hidden
      let value = values[key];
      if (typeof value === 'string') {
        value = value.trim();
      }
      // check array
      if (value && Array.isArray(value)) {
        const check = value.filter(
          (y) => typeof y !== 'undefined' && (y || Number.isNaN(Number(y))),
        );
        value = check.length ? check : null;
      }
      // check empty
      if (!value && value !== 0) {
        return false;
      }
      return true;
    })
    .map((key) => {
      const value = values[key];
      return { [key]: value };
    })
    .reduce((res, current) => ({ ...res, ...current }), {});

const style = {
  flex: 1,
};

const FormContainer = ({
  onSubmit,
  setShowDialogMenu,
  db,
  forms = {},
  isNewSubmission = false,
}) => {
  const [activeGroup, setActiveGroup] = useState(0);
  const [showQuestionGroupList, setShowQuestionGroupList] = useState(false);
  const [datapoint, setDatapoint] = useState(null);
  const [fillingForm, setFillingForm] = useState(true);
  const currentValues = FormState.useState((s) => s.currentValues);
  const cascades = FormState.useState((s) => s.cascades);
  const activeLang = FormState.useState((s) => s.lang);
  const repeats = FormState.useState((s) => s.repeats);
  const prevAdmAnswer = FormState.useState((s) => s.prevAdmAnswer);
  const route = useRoute();

  const dependantQuestions =
    forms?.question_group
      ?.flatMap((qg) => qg.question)
      .filter((q) => q?.dependency && q?.dependency?.length)
      ?.map((q) => ({ id: q.id, dependency: q.dependency })) || [];

  const formDefinition = transformForm(forms, currentValues, activeLang, repeats, prevAdmAnswer);
  const activeQuestions = formDefinition?.question_group
    ?.flatMap((qg) => qg?.question)
    .filter((q) => q); // Filter out null/undefined values
  const currentGroup = useMemo(
    () => formDefinition?.question_group?.[activeGroup],
    [activeGroup, formDefinition?.question_group],
  );

  const handleOnSubmitForm = () => {
    // Use currentValues directly as our base to ensure we preserve all values
    const reIndexedValues = { ...currentValues };

    // Find all questions that belong to repeatable groups
    const repeatableGroups = formDefinition?.question_group?.filter((qg) => qg.repeatable) || [];

    // Process each repeatable question group
    repeatableGroups.forEach((group) => {
      const groupId = group.id || group.name;
      const groupRepeats = repeats[groupId] || [0];

      if (!groupRepeats || groupRepeats.length <= 1) {
        // No repeats to re-index
        return;
      }

      // Get all questions in this group
      const questions = group.question || [];

      // Process each question in the repeatable group
      questions.forEach((question) => {
        const questionId = question.id;

        // Find all repeat instances of this question in currentValues
        // This would match both `123` and `123-0`, `123-1`, etc.
        const questionEntries = Object.entries(currentValues)
          .filter(([key]) => {
            const [qId, repeatIndex] = key.includes('-') ? key.split('-') : [key, null];
            return qId === `${questionId}` && repeatIndex !== null;
          })
          .sort(([keyA], [keyB]) => {
            // Sort by repeat index
            const [, indexA] = keyA.split('-');
            const [, indexB] = keyB.split('-');
            return parseInt(indexA, 10) - parseInt(indexB, 10);
          });

        // If there are entries to re-index
        if (questionEntries.length > 0) {
          // First, remove all the existing entries from reIndexedValues
          questionEntries.forEach(([key]) => {
            delete reIndexedValues[key];
          });

          // Now add back the entries with sequential indices
          // Skip index 0 in groupRepeats as it's the base non-repeat
          const repeatsExcludingBase = groupRepeats.slice(1);

          // Map each actual repeat value to a new sequential index
          repeatsExcludingBase.forEach((actualIndex, newIndex) => {
            // Find the matching entry for this repeat
            questionEntries.forEach(([key, value]) => {
              const [baseId, repeatIndex] = key.split('-');
              if (parseInt(repeatIndex, 10) === actualIndex) {
                // Re-add with a sequential index
                reIndexedValues[`${baseId}-${newIndex + 1}`] = value;
              }
            });
          });
        }
      });
    });

    // Filter and process values as before, but with the re-indexed values
    const validValues = Object.keys(reIndexedValues)
      .filter((key) => activeQuestions.filter((q) => `${q.id}` === `${key}`).length > 0)
      .reduce((prev, current) => ({ ...prev, [current]: reIndexedValues[current] }), {});

    const results = checkValuesBeforeCallback({ values: validValues });
    if (onSubmit) {
      const { dpName, dpGeo } = generateDataPointName(forms, validValues, cascades, datapoint);
      onSubmit({ name: dpName, geo: dpGeo, answers: results });
    }
  };

  const handleOnActiveGroup = (page) => {
    const group = formDefinition?.question_group?.[page];
    const currentPrefilled = group.question
      ?.filter((q) => q?.pre && q?.id)
      ?.filter(
        (q) => currentValues?.[q.id] === null || typeof currentValues?.[q.id] === 'undefined',
      )
      ?.map((q) => {
        const questionName = Object.keys(q.pre)?.[0];
        const findQuestion = activeQuestions.find((aq) => aq?.name === questionName);
        const prefillValue = q.pre?.[questionName]?.[currentValues?.[findQuestion?.id]];
        return { [q.id]: prefillValue };
      })
      ?.reduce((prev, current) => ({ ...prev, ...current }), {});
    if (Object.keys(currentPrefilled).length) {
      FormState.update((s) => {
        s.loading = true;
        s.currentValues = {
          ...s.currentValues,
          ...currentPrefilled,
        };
      });
      const interval = group?.question?.length || 0;
      setTimeout(() => {
        setActiveGroup(page);
        FormState.update((s) => {
          s.loading = false;
        });
      }, interval);
    } else {
      setActiveGroup(page);
    }
  };

  const fetchInitialValues = useCallback(async () => {
    // get initial values from crudDatapoints get by route.params?.uuid
    if (!db || !route?.params?.uuid || !isNewSubmission) {
      setFillingForm(false);
      return;
    }
    const questionsMap = forms?.question_group
      ?.flatMap((qg) => qg.question)
      ?.reduce((map, question) => {
        if (question.name && question.id) {
          map[question.name] = question;
        }
        return map;
      }, {});
    // Stored answers flatten cascades to their last value (transformAnswers) and may
    // hold options as plain strings; the form and its Yup schemas expect arrays.
    const arrayTypes = ['cascade', 'option', 'multiple_option'];

    const findDatapoint = await crudDataPoints.getByUUID(db, { uuid: route?.params?.uuid });
    if (findDatapoint?.json && !datapoint) {
      const findForm = await crudForms.selectFormById(db, { id: findDatapoint?.form });
      if (findForm?.json) {
        let dpValues = JSON.parse(findDatapoint.json);
        if (typeof dpValues === 'string') {
          /**
           * Double parse to ensure that the JSON is correctly formatted
           */
          dpValues = JSON.parse(dpValues);
        }
        const initialValues = {};
        let maxRepeatIndex = 0;

        Object.entries(dpValues).forEach(([key, value]) => {
          const [qId, qIndex] = key.split('-');
          if (qIndex) {
            const repeatIndex = parseInt(qIndex, 10);
            if (repeatIndex > maxRepeatIndex) {
              maxRepeatIndex = repeatIndex;
            }
          }
          // Get question name by qId
          const qName = JSON.parse(findForm?.json)
            ?.question_group?.flatMap((qg) => qg?.question)
            ?.find((q) => q.id === parseInt(qId, 10))?.name;
          if (questionsMap?.[qName]) {
            const { id: currentQuestion, type } = questionsMap[qName];
            const isScalar = value !== null && value !== undefined && !Array.isArray(value);
            const fieldValue = arrayTypes.includes(type) && isScalar ? [value] : value;
            if (qIndex) {
              initialValues[`${currentQuestion}-${qIndex}`] = fieldValue;
            } else {
              initialValues[currentQuestion] = fieldValue;
            }
          }
        });
        FormState.update((s) => {
          s.currentValues = initialValues;
        });
        setTimeout(() => {
          setFillingForm(false);
        }, 500);
      }
      setDatapoint(findDatapoint);
    }
  }, [db, isNewSubmission, forms, route?.params?.uuid, datapoint]);

  // Fetch initial values when the component mounts
  useEffect(() => {
    fetchInitialValues();
  }, [fetchInitialValues]);

  // Add the initial active group to visitedQuestionGroup
  useEffect(() => {
    const initialGroup = formDefinition?.question_group?.[activeGroup];
    if (initialGroup?.id !== undefined) {
      FormState.update((s) => {
        if (!s.visitedQuestionGroup.includes(initialGroup.id)) {
          s.visitedQuestionGroup = [...s.visitedQuestionGroup, initialGroup.id];
        }
      });
    }
  }, [formDefinition, activeGroup]);

  if (fillingForm) {
    return (
      <View
        style={{
          flex: 1,
          width: '100%',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <BaseLayout.Content>
        <View style={style}>
          {!showQuestionGroupList ? (
            <QuestionGroup
              index={activeGroup}
              group={currentGroup}
              activeQuestions={activeQuestions}
              dependantQuestions={dependantQuestions}
            />
          ) : (
            <QuestionGroupList
              form={formDefinition}
              activeQuestionGroup={activeGroup}
              setActiveQuestionGroup={setActiveGroup}
              setShowQuestionGroupList={setShowQuestionGroupList}
            />
          )}
        </View>
      </BaseLayout.Content>
      <FormNavigation
        currentGroup={currentGroup}
        formDefinition={formDefinition}
        onSubmit={handleOnSubmitForm}
        activeGroup={activeGroup}
        setActiveGroup={handleOnActiveGroup}
        totalGroup={formDefinition?.question_group?.length || 0}
        showQuestionGroupList={showQuestionGroupList}
        setShowQuestionGroupList={setShowQuestionGroupList}
        setShowDialogMenu={setShowDialogMenu}
      />
    </>
  );
};

export default FormContainer;
