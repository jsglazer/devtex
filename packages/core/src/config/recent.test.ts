import { describe, expect, it } from 'vitest';
import { addRecent, loadRecent, MAX_RECENT, removeRecent, serializeRecent } from './recent.js';

describe('recent.json', () => {
  it('adds to the front, de-duplicates and caps at 15', () => {
    let list: string[] = [];
    for (let i = 0; i < 20; i++) list = addRecent(list, `/p/${i}`);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe('/p/19');
    list = addRecent(list, '/p/10');
    expect(list[0]).toBe('/p/10');
    expect(list.filter((p) => p === '/p/10')).toHaveLength(1);
    expect(list).toHaveLength(MAX_RECENT);
  });

  it('round-trips and tolerates bad input', () => {
    const list = ['/a', '/b'];
    expect(loadRecent(serializeRecent(list))).toEqual(list);
    expect(loadRecent(null)).toEqual([]);
    expect(loadRecent('{oops')).toEqual([]);
    expect(loadRecent('{"a":1}')).toEqual([]);
    expect(loadRecent('["/a", 3, "", "/a", "/b"]')).toEqual(['/a', '/b']);
    expect(removeRecent(list, '/a')).toEqual(['/b']);
  });
});
