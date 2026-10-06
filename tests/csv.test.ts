import test from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, toCsv } from '../src/lib/csv.ts'
import { parseCsv } from '../src/lib/importParse.ts'

test('csvCell: quoting rules and numbers/null', () => {
  assert.equal(csvCell('plain'), 'plain'); assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"'); assert.equal(csvCell(null), ''); assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(42), '42'); assert.equal(csvCell(-5), '-5', 'negative NUMBERS are not text'); assert.equal(csvCell(true), 'true')
})
test('csvCell: formula-injection guard on text cells', () => {
  for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '=HYPERLINK("http://evil","x")']) assert.ok(csvCell(evil).replace(/^"/, '').startsWith("'"), evil)
  assert.equal(csvCell('Asha = great'), 'Asha = great')
})
test('toCsv: BOM, header order, CRLF, missing keys, and a lossless round trip through parseCsv', () => {
  const rows = [{ roll: '1GA1', name: 'Ünï, "Q"', note: 'a\nb', pts: 0 }, { roll: '1GA2', name: 'Bob' }]
  const csv = toCsv(['roll', 'name', 'note', 'pts'], rows)
  assert.ok(csv.startsWith('\ufeffroll,name,note,pts\r\n')); assert.ok(csv.endsWith('\r\n'))
  assert.deepEqual(parseCsv(csv), [['roll', 'name', 'note', 'pts'], ['1GA1', 'Ünï, "Q"', 'a\nb', '0'], ['1GA2', 'Bob', '', '']])
  assert.ok(!toCsv(['a'], [], { bom: false }).startsWith('\ufeff')); assert.equal(toCsv(['a', 'b'], [], { bom: false }), 'a,b\r\n')
})
