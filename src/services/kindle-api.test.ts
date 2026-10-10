import { EventEmitter } from 'events';
import { describe,it,expect,vi } from 'vitest';
import * as cheerio from 'cheerio';
vi.mock('obsidian',()=>({Notice:vi.fn()}));
vi.mock('../modals/AmazonLoginModal',()=>({AmazonLoginModal:vi.fn()}));
vi.mock('../utils/remote-loader',()=>({loadRemoteDom:vi.fn()}));
import { loadRemoteDom } from '../utils/remote-loader';
import { KindleApiService } from './kindle-api';
const notebook=()=>'<div id="kp-notebook-library">'+Array.from({length:12},(_,i)=>`<div class="kp-notebook-library-each-book" id="ASIN${i}"><h2 class="kp-notebook-searchable">Book ${i}</h2><input id="kp-notebook-annotated-date-${i}" value="Thursday, October 8, 2026"></div>`).join('')+'</div>';
describe('Kindle fetching completeness',()=>{
 it('fetches every listed book and excludes failed books from note updates',async()=>{
  vi.mocked(loadRemoteDom).mockImplementation(async url=>{
   if(url.includes('asin=ASIN2&'))throw Error('Network failed');
   const html=url.includes('?')?'<div id="kp-notebook-annotations"><div class="a-row a-spacing-base"><span id="highlight">abc</span><input id="kp-annotation-location" value="10"></div></div>':notebook();
   return {dom:cheerio.load(html),html,finalUrl:url};
  });
  const api=new KindleApiService({} as any);
  (api as any).loggedIn=true;(api as any).loginWindow={isDestroyed:()=>false};
  const result=await api.fetchHighlights('co.jp',new EventEmitter());
  expect(result.books).toHaveLength(11);
  expect(result.books.some(b=>b.asin==='ASIN11')).toBe(true);
  expect(result.books.some(b=>b.asin==='ASIN2')).toBe(false);
  expect(result.highlights).toHaveLength(11);
  expect(result.books[0].lastAnnotatedDate?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
 });
 it('rejects an expired session redirect instead of treating it as an empty library',async()=>{
  vi.mocked(loadRemoteDom).mockResolvedValue({dom:cheerio.load('<form id="ap_signin_form"></form>'),html:'<form id="ap_signin_form"></form>',finalUrl:'https://www.amazon.co.jp/ap/signin'});
  const api=new KindleApiService({} as any);
  (api as any).loggedIn=true;(api as any).loginWindow={isDestroyed:()=>false};
  await expect(api.fetchHighlights('co.jp',new EventEmitter())).rejects.toThrow();
 });
});
