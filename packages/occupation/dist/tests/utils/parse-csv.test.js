import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsvRecords } from '../../src/utils/csv/parse-csv.js';
test('parseCsvRecords handles mixed newline styles without merging records', () => {
    const records = parseCsvRecords([
        'role_head,alias,note',
        'technician,tehnician,Existing CRLF row',
        'mechanic,electromechanic,Inserted LF row',
        'seller,vanzator,Following CRLF row'
    ].join('\r\n').replace('mechanic,electromechanic,Inserted LF row\r\n', 'mechanic,electromechanic,Inserted LF row\n'));
    assert.deepEqual(records.map((record) => [record.role_head, record.alias, record.note]), [
        ['technician', 'tehnician', 'Existing CRLF row'],
        ['mechanic', 'electromechanic', 'Inserted LF row'],
        ['seller', 'vanzator', 'Following CRLF row']
    ]);
});
