import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein } from '../src/levenshtein.ts';

// Pre-computed word pairs with known classic Levenshtein distances.
const pairs: Array<[string, string, number]> = [
  ['', '', 0],
  ['a', '', 1],
  ['', 'abc', 3],
  ['kitten', 'sitting', 3],
  ['flaw', 'lawn', 2],
  ['book', 'book', 0],
  ['book', 'books', 1],
  ['book', 'boot', 1],
  ['speling', 'spelling', 1],
  ['bookk', 'book', 1],
  ['recieve', 'receive', 2],
  ['abc', 'acb', 2],
  ['gumbo', 'gambol', 2],
  ['saturday', 'sunday', 3],
  ['intention', 'execution', 5],
  ['cat', 'dog', 3],
  ['abc', 'abcd', 1],
  ['abcd', 'abc', 1],
];

test('levenshtein matches known distances', () => {
  for (const [a, b, expected] of pairs) {
    assert.equal(levenshtein(a, b), expected, `levenshtein(${a}, ${b})`);
  }
});

test('levenshtein is symmetric', () => {
  for (const [a, b] of pairs) {
    assert.equal(levenshtein(a, b), levenshtein(b, a));
  }
});
