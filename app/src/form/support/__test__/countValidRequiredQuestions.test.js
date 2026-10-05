import { countValidRequiredQuestions } from '../QuestionGroupList';

// Pulled in transitively via src/lib; their native modules are absent under Jest.
jest.mock('expo-task-manager', () => ({}));
jest.mock('expo-background-task', () => ({}));

const form = {
  question_group: [
    {
      id: 1,
      question: [{ id: 1, label: 'Name', type: 'input', required: true }],
    },
    {
      id: 2,
      question: [
        { id: 2, label: 'Chlorine', type: 'number', required: true },
        { id: 3, label: 'Region', type: 'cascade', required: true },
      ],
    },
    {
      id: 3,
      question: [{ id: 4, label: 'Comment', type: 'text', required: false }],
    },
  ],
};

describe('countValidRequiredQuestions', () => {
  it('marks a group invalid when an answer is present but fails its schema', async () => {
    // 0.5 is truthy but fails the integer rule; a scalar cascade fails the array type.
    const res = await countValidRequiredQuestions(form, { 1: 'Noa', 2: 0.5, 3: 10 });
    expect(res).toEqual({ totalFilled: 1, totalRequired: 3, groupsValid: [true, false, true] });
  });

  it('marks every group valid once all required answers pass', async () => {
    const res = await countValidRequiredQuestions(form, { 1: 'Noa', 2: 5, 3: [10] });
    expect(res).toEqual({ totalFilled: 3, totalRequired: 3, groupsValid: [true, true, true] });
  });
});
