import test from 'node:test'
import assert from 'node:assert/strict'
import { parseParticipants, MAX_IMPORT_ROWS } from '../src/lib/participants.ts'
import { parseCsv } from '../src/lib/importParse.ts'
import { readFileSync } from 'node:fs'

const parse = (csv: string, existing?: any) => parseParticipants(parseCsv(csv), existing)

test('valid rows are normalised (roll upper-case, email lower-case, spaces collapsed) and header aliases work', () => {
  const r = parse('USN,Name,College Email,Dept,Semester\n 1ga23cs001 ,  Asha   Rao ,ASHA@Example.EDU,CSE,3\n')
  assert.deepEqual(r.fileErrors, []); assert.deepEqual(r.valid, [{ roll_number: '1GA23CS001', full_name: 'Asha Rao', email: 'asha@example.edu', department: 'CSE', year: 3 }])
})
test('the shipped template file imports cleanly', () => {
  const r = parse(readFileSync(new URL('../public/participants-template.csv', import.meta.url), 'utf8'))
  assert.equal(r.valid.length, 3); assert.equal(r.invalid.length, 0)
})
test('optional columns may be absent or blank', () => {
  const r = parse('roll_number,full_name,email\nABC123,Al Bo,a@b.co\n'); assert.equal(r.valid[0].department, null); assert.equal(r.valid[0].year, null)
})
test('missing / malformed values produce specific per-row messages and the row is excluded', () => {
  const r = parse('roll_number,full_name,email,year\n,No Roll,a@b.co,1\nAB,Short Roll,b@b.co,1\nGOOD1,,c@b.co,1\nGOOD2,Bad Mail,not-an-email,1\nGOOD3,Bad Year,d@b.co,9\nGOOD4,Bad Year Text,e@b.co,two\nG O,Space Roll,f@b.co,1\n')
  assert.equal(r.valid.length, 0); assert.equal(r.invalid.length, 7)
  const msgs = r.invalid.map(x => x.errors.join(' '))
  assert.match(msgs[0], /Roll number is missing/); assert.match(msgs[1], /3-30/); assert.match(msgs[2], /Full name is missing/)
  assert.match(msgs[3], /Email address is not valid/); assert.match(msgs[4], /1 to 8/); assert.match(msgs[5], /1 to 8/); assert.match(msgs[6], /Roll number may contain only/)
  assert.deepEqual(r.invalid.map(x => x.line), [2, 3, 4, 5, 6, 7, 8])
})
test('duplicates inside the file (roll or email, case-insensitive) flag the LATER row and point at the first', () => {
  const r = parse('roll_number,full_name,email\nR001,A One,one@x.co\nr001,A Dup Roll,two@x.co\nR003,A Dup Mail,ONE@x.co\nR004,Fine,four@x.co\n')
  assert.deepEqual(r.valid.map(v => v.roll_number), ['R001', 'R004'])
  assert.match(r.invalid[0].errors[0], /Duplicate roll number \(first seen on line 2\)/); assert.match(r.invalid[1].errors[0], /Duplicate email \(first seen on line 2\)/)
})
test('duplicates against already-imported participants are rejected', () => {
  const r = parse('roll_number,full_name,email\nR001,Aa,a@x.co\nR002,Bb,b@x.co\n', { rolls: new Set(['R001']), emails: new Set(['b@x.co']) })
  assert.equal(r.valid.length, 0); assert.match(r.invalid[0].errors[0], /Roll number is already/); assert.match(r.invalid[1].errors[0], /Email is already/)
})
test('mixed file: valid rows still import while invalid ones are listed (partial success is explicit)', () => {
  const r = parse('roll_number,full_name,email\nR001,Aa,a@x.co\nbad,,x\nR002,Bb,b@x.co\n')
  assert.equal(r.valid.length, 2); assert.equal(r.invalid.length, 1); assert.equal(r.rows.length, 3)
})
test('file-level problems: empty, header only, missing required columns, too many rows', () => {
  assert.match(parse('').fileErrors[0], /header row/); assert.match(parse('roll_number,full_name,email\n').fileErrors[0], /header row/)
  const m = parse('roll_number,name\nR1,A\n'); assert.ok(m.fileErrors.some(e => e.includes('"email"'))); assert.equal(m.valid.length, 0)
  const big = 'roll_number,full_name,email\n' + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `R${i},N${i},n${i}@x.co`).join('\n')
  assert.match(parse(big).fileErrors[0], /Too many rows/)
})
test('Excel-style files (BOM + CRLF + quoted commas) parse correctly', () => {
  const r = parse('\ufeffroll_number,full_name,email\r\nR001,"Rao, Asha",a@x.co\r\n'); assert.deepEqual(r.fileErrors, []); assert.equal(r.valid[0].full_name, 'Rao, Asha')
})
test('formula-looking names are accepted as data (they are neutralised when exported, see csv.test.ts)', () => {
  assert.equal(parse('roll_number,full_name,email\nR001,=cmd|x,a@x.co\n').valid.length, 1)
})

test('names shorter than 2 characters are rejected', () => { const r = parse('roll_number,full_name,email\nR001,A,a@x.co\n'); assert.equal(r.valid.length, 0); assert.match(r.invalid[0].errors[0], /2-120/) })
