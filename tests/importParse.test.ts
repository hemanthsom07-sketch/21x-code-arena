import test from 'node:test'
import assert from 'node:assert/strict'
import { parseImport, parseCsv } from '../src/lib/importParse.ts'

test('CSV: quoted commas/newlines, grouping rows into questions, per-row validation', () => {
  const csv = 'title,statement,difficulty,points,languages,input,expected_output,is_hidden\n"Sum, two","Add a and b\nline2",easy,50,c|python,"1 2",3,false\n"Sum, two",,,,,"5 7",12,true\nBad,stmt,extreme,0,java,,,true\n'
  const r = parseImport('x.csv', csv)
  assert.equal(r.questions.length, 2); assert.equal(r.questions[0].title, 'Sum, two'); assert.equal(r.questions[0].statement, 'Add a and b\nline2')
  assert.equal(r.questions[0].test_cases.length, 2); assert.equal(r.questions[0].test_cases[0].is_hidden, false); assert.equal(r.questions[0].test_cases[1].is_hidden, true)
  assert.ok(['difficulty', 'languages', 'points'].every(k => r.errors.some(e => e.includes(k))))
  assert.equal(r.errors.filter(e => e.includes('Sum')).length, 0)
})
test('CSV: UTF-8 BOM (Excel "CSV UTF-8") and CRLF line endings are accepted', () => {
  const csv = '\ufefftitle,statement,input,expected_output\r\nHello,Print hi,,hi\r\n'
  const r = parseImport('excel.csv', csv)
  assert.deepEqual(r.errors, []); assert.equal(r.questions[0].title, 'Hello'); assert.equal(r.questions[0].test_cases[0].expected_output, 'hi')
  assert.equal(parseCsv('\ufeffa,b\r\n1,2')[0][0], 'a')
})
test('CSV: missing required columns are reported', () => assert.ok(parseImport('x.csv', 'title,statement\nA,B\n').errors.some(e => e.includes('input'))))
test('JSON: defaults, BOM, array or {questions}, invalid input', () => {
  const j = parseImport('x.json', '\ufeff' + JSON.stringify({ questions: [{ title: 'Hello', statement: 's', test_cases: [{ input: '', expected_output: 'hi' }] }] }))
  assert.deepEqual(j.errors, []); assert.equal(j.questions[0].test_cases[0].is_hidden, true); assert.equal(j.questions[0].points, 100)
  assert.deepEqual(j.questions[0].languages, ['c', 'python'])
  assert.ok(parseImport('x.json', '{bad').errors[0].includes('valid JSON'))
  assert.ok(parseImport('x.json', '[{"title":"ab"}]').errors.length >= 3)
})
