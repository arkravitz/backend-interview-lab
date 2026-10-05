"""Run against npm run dev with Python Playwright. LAB_BROWSER_CHANNEL=chrome uses installed Chrome."""
import json, os, re, unittest
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
URL=os.environ.get('LAB_URL','http://localhost:3000')
ROOT=Path(__file__).resolve().parents[1]
CODING=json.loads((ROOT/'app/data/coding.json').read_text())
DESIGNS=json.loads((ROOT/'app/data/design.json').read_text())
SOURCE='x = 1\ny = 2\nprint(x + y)\n'
WALK={'title':'Correct the starting value','explanation':'The first assignment makes the total too small.','hints':['Check the starting value.','Trace x before the addition.','Use three for x.'],'steps':['The current sum is 1 + 2 = 3.','Use 3 + 2 = 5, then run the tests.'],'solution':'Update the initial assignment. Time and space remain constant.','edits':[{'before':'x = 1','after':'x = 3','explanation':'Initialize x to the required value.'}]}
class PracticeTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.pw=sync_playwright().start();cls.browser=cls.pw.chromium.launch(headless=True,channel=os.environ.get('LAB_BROWSER_CHANNEL') or None)
 @classmethod
 def tearDownClass(cls):cls.browser.close();cls.pw.stop()
 def setUp(self):
  self.context=self.browser.new_context(viewport={'width':1440,'height':1000});self.page=self.context.new_page();self.errors=[]
  self.page.on('pageerror',lambda e:self.errors.append(str(e)));self.page.goto(URL);self.page.wait_for_load_state('networkidle')
 def tearDown(self):self.context.close();self.assertEqual(self.errors,[])
 def test_library_uses_alphabetical_titles(self):
  expect(self.page.get_by_role('button',name='Practice plan',exact=True)).to_have_count(0)
  titles=self.page.locator('.problem-table .problem-link').all_text_contents()
  self.assertTrue(titles)
  self.assertEqual(titles,sorted(titles,key=str.casefold))
  self.page.goto(URL+'?view=guide');self.page.wait_for_load_state('networkidle')
  expect(self.page.locator('.problem-library')).to_be_visible()
 def open_problem(self):self.page.wait_for_load_state('networkidle');self.page.get_by_role('button',name='Open '+CODING[0]['title'],exact=True).click()
 def edit(self,text):self.page.get_by_role('textbox',name='Python code',exact=True).fill(text)
 def seed(self,drafts):
  self.page.evaluate('(data)=>localStorage.setItem("interview-lab-v1",JSON.stringify(data))',drafts);self.page.reload();self.page.wait_for_load_state('networkidle')
 def connect(self):
  self.page.get_by_role('button',name='AI settings',exact=True).click();self.page.get_by_label('DeepSeek API key',exact=True).fill('test-key-not-real');self.page.get_by_role('button',name='Save API key').click()
 def coach(self):self.page.get_by_role('button',name='AI coach',exact=True).click()
 def mock_walk(self,walk=WALK):
  self.requests=[]
  def respond(route):
   self.requests.append(route.request.post_data_json);route.fulfill(json={'content':json.dumps(walk),'walkthrough':walk,'model':'deepseek-flash'})
  self.page.route('**/api/coach',respond)
 def get_hint(self):
  self.connect();self.open_problem();self.edit(SOURCE);self.page.get_by_role('button',name='Hint',exact=True).click();expect(self.page.get_by_text(WALK['title'],exact=True)).to_be_visible()
 def show_edits(self):
  self.page.locator('.coach-message summary').filter(has_text='Suggested code edits').click();self.page.get_by_role('button',name='Review edits in editor',exact=True).click()
 def test_library_search_filters_and_empty_state(self):
  expect(self.page.locator('.problem-table tbody tr')).to_have_count(len(CODING));self.page.get_by_label('Filter by topic').select_option('Graphs');expect(self.page.locator('.problem-table tbody tr')).to_have_count(3)
  self.page.get_by_label('Search library').fill('no such problem');expect(self.page.get_by_text('No problems match those filters.')).to_be_visible();self.page.get_by_role('button',name='Clear filters').click();expect(self.page.locator('.problem-table tbody tr')).to_have_count(len(CODING))
 def test_legacy_drafts_and_stage_isolation(self):
  self.seed({'ttl':{'code':'print("base")','followupCode':'print("follow")','notes':'base notes','followupNotes':'follow notes','done':True}});self.open_problem()
  expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('base');self.page.get_by_role('button',name='Follow-up lab',exact=True).click();self.edit('print("changed follow")')
  self.page.get_by_role('button',name='Base problem',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('base');self.page.get_by_role('tab',name='Notes',exact=True).click();expect(self.page.get_by_label('Reasoning, complexity & self-review')).to_have_value('base notes')
  self.page.reload();self.page.get_by_role('button',name='Follow-up lab',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('changed follow')
 def test_reset_code_confirmation_and_stage_isolation(self):
  self.seed({'ttl':{'code':'print("base draft")','followupCode':'print("follow draft")','notes':'keep notes'}});self.open_problem()
  self.page.locator('.editor-filebar').get_by_role('button',name='Reset code',exact=True).click();dialog=self.page.get_by_role('alertdialog');expect(dialog).to_be_visible()
  dialog.get_by_role('button',name='Cancel',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('base draft')
  self.page.locator('.editor-filebar').get_by_role('button',name='Reset code',exact=True).click();dialog.get_by_role('button',name='Reset code',exact=True).click();expect(dialog).not_to_be_visible()
  self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem("interview-lab-v1")).ttl.code'),CODING[0]['starter'])
  self.page.get_by_role('button',name='Follow-up lab',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('follow draft')
  self.page.locator('.editor-filebar').get_by_role('button',name='Reset code',exact=True).click();dialog.get_by_role('button',name='Reset code',exact=True).click()
  followups=json.loads((ROOT/'app/data/followups.json').read_text());self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem("interview-lab-v1")).ttl.followupCode'),followups[0]['starter'])
  # A refresh keeps the follow-up stage, so returning to the base problem is
  # now an explicit choice rather than a side effect of re-opening from the
  # library. The reset above survived, and the two stages stay separate.
  self.page.reload();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text(followups[0]['starter'].split(chr(10))[0])
  self.page.get_by_role('button',name='Base problem',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('class TTLStore');self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem("interview-lab-v1")).ttl.notes'),'keep notes')
 def test_reviewed_status_filter(self):
  self.open_problem();self.page.get_by_role('checkbox',name='Reviewed',exact=True).check();self.page.get_by_role('button',name='Problems',exact=True).click();self.page.get_by_label('Filter by status').select_option('Reviewed');expect(self.page.locator('.problem-table tbody tr')).to_have_count(1)
 def test_corrupt_storage_recovers(self):
  self.page.evaluate('localStorage.setItem("interview-lab-v1","broken json")');self.page.reload();expect(self.page.get_by_text('could not be read',exact=False)).to_be_visible()
  self.assertEqual(self.page.evaluate('localStorage.getItem("interview-lab-v1")'),'broken json')
  self.open_problem();self.edit('print(1)');self.assertIn('print(1)',self.page.evaluate('localStorage.getItem("interview-lab-v1")'))
 def test_timer_start_pause_reset(self):
  self.open_problem();self.page.get_by_role('button',name='Start timer',exact=True).click();expect(self.page.locator('.timer-value')).not_to_have_text('60:00',timeout=4000);self.page.get_by_role('button',name='Pause timer',exact=True).click();self.page.get_by_role('button',name='Reset timer',exact=True).click();expect(self.page.locator('.timer-value')).to_have_text('60:00')
 def test_run_is_quick_and_does_not_create_submission(self):
  self.open_problem();self.edit(CODING[0]['solution']);self.page.get_by_role('button',name='Run',exact=True).click();expect(self.page.get_by_text(f'Quick run: 2 of {len(CODING[0]["tests"])} groups passed',exact=True)).to_be_visible(timeout=90000)
  expect(self.page.get_by_text('Quick check passed',exact=True)).to_be_visible();expect(self.page.get_by_text('Accepted',exact=True)).to_have_count(0)
  self.page.get_by_role('tab',name='Submissions',exact=True).click();expect(self.page.get_by_text('No submissions yet',exact=True)).to_be_visible()
  self.edit(CODING[0]['solution']+'\n# edited');expect(self.page.get_by_text('Code changed since this run.',exact=False)).to_be_visible()
 def test_submission_full_suite_snapshot_and_reload(self):
  self.open_problem();self.edit(CODING[0]['solution']);self.page.get_by_role('button',name='Submit',exact=True).click();expect(self.page.locator('.submission-verdict')).to_contain_text('Accepted',timeout=90000);expect(self.page.get_by_text('Passed test groups: 5 / 5',exact=True)).to_be_visible()
  self.edit('print("new draft")');expect(self.page.get_by_role('textbox',name='Submitted code',exact=True)).to_contain_text('class TTLStore')
  self.page.reload();self.page.get_by_role('tab',name='Submissions',exact=True).click();expect(self.page.locator('.submissions-table tbody tr')).to_have_count(1)
  self.page.get_by_role('button',name='Follow-up lab',exact=True).click();self.page.get_by_role('tab',name='Submissions',exact=True).click();expect(self.page.get_by_text('No submissions yet',exact=True)).to_be_visible()
 def test_failed_submission_suggest_fix_sends_matching_snapshot(self):
  self.mock_walk();self.connect();self.open_problem();self.edit(SOURCE);self.page.get_by_role('button',name='Submit',exact=True).click();expect(self.page.locator('.submission-verdict')).to_contain_text('Runtime Error',timeout=90000)
  self.edit('x = 100');self.page.locator('.question-scroll').get_by_role('button',name='Suggest Fix',exact=True).click();expect(self.page.get_by_text(WALK['title'],exact=True)).to_be_visible();self.assertEqual(self.requests[0]['code'],SOURCE);self.assertIn('NameError',self.requests[0]['context'])
  self.show_edits();expect(self.page.locator('.proposal-banner')).to_contain_text('Your code changed');expect(self.page.get_by_role('button',name='Accept edit 1',exact=True)).to_have_count(0)
 def test_submission_filter_explains_an_empty_result(self):
  self.open_problem();self.edit(CODING[0]['starter']);self.page.get_by_role('button',name='Submit',exact=True).click();expect(self.page.locator('.submission-verdict')).to_contain_text('Wrong Answer',timeout=90000)
  self.page.get_by_role('button',name='All submissions',exact=True).click();self.page.locator('.submission-filters').get_by_role('button',name='Accepted',exact=True).click()
  expect(self.page.get_by_text('No accepted submissions',exact=True)).to_be_visible();self.page.get_by_role('button',name='Show all submissions',exact=True).click();expect(self.page.locator('.submissions-table tbody tr')).to_have_count(1)
 def test_failed_run_accept_fix_and_resubmit(self):
  walk={**WALK,'edits':[{'before':'now > expires_at','after':'now >= expires_at','explanation':'The expiry boundary is inclusive.'}]}
  broken=CODING[0]['solution'].replace('now >= expires_at','now > expires_at')
  # The test breaks the inclusive boundary by editing the reference solution,
  # so assert the mutation actually applied rather than failing later with a
  # confusing verdict mismatch.
  self.assertNotEqual(broken,CODING[0]['solution'],'mutation did not apply to the solution')
  self.mock_walk(walk);self.connect();self.open_problem();self.edit(broken)
  self.page.get_by_role('button',name='Submit',exact=True).click();expect(self.page.locator('.submission-verdict')).to_contain_text('Wrong Answer',timeout=90000)
  self.page.locator('.output-status').get_by_role('button',name='Suggest Fix',exact=True).click();expect(self.page.get_by_text(WALK['title'],exact=True)).to_be_visible();self.show_edits()
  self.page.get_by_role('button',name='Accept edit 1',exact=True).click();self.page.get_by_role('button',name='Submit',exact=True).click();expect(self.page.locator('.submission-verdict')).to_contain_text('Accepted',timeout=90000)
 def test_scratch_stdout_stdin(self):
  self.open_problem();self.edit('print(input())');self.page.get_by_role('button',name='Console',exact=False).click();self.page.locator('summary').filter(has_text='Scratch code & standard input').click();self.page.get_by_role('textbox',name='Standard input',exact=True).fill('hello');self.page.get_by_role('button',name='Run code',exact=True).click();expect(self.page.locator('.console-scroll pre')).to_have_text('hello\n',timeout=90000)
 def test_python_stop_and_navigation(self):
  self.open_problem();self.edit('while True: pass');self.page.get_by_role('button',name='Run',exact=True).click();self.page.get_by_role('button',name='Stop',exact=True).click();expect(self.page.get_by_role('button',name='Run',exact=True)).to_be_enabled();self.page.get_by_role('button',name='Follow-up lab',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('AdvancedTTLStore')
 def test_timeout_is_a_saved_failure(self):
  self.open_problem();self.edit('while True: pass');self.page.get_by_role('button',name='Submit',exact=True).click();expect(self.page.locator('.submission-verdict')).to_contain_text('Time Limit Exceeded',timeout=100000);expect(self.page.locator('.output-status').get_by_role('button',name='Suggest Fix',exact=True)).to_be_visible()
 def test_persistent_key_and_forget(self):
  self.connect();self.page.reload();self.page.wait_for_load_state('networkidle');self.page.get_by_role('button',name='AI settings',exact=True).click();expect(self.page.get_by_label('DeepSeek API key')).to_have_value('test-key-not-real');self.page.get_by_role('button',name='Forget key',exact=True).click();self.assertIsNone(self.page.evaluate('localStorage.getItem("interview-lab-deepseek-key")'))
 def test_export_excludes_key(self):
  self.connect();self.open_problem();self.edit('print("saved")')
  with self.page.expect_download() as download:self.page.get_by_role('button',name='Export work',exact=True).click()
  data=Path(download.value.path()).read_text();self.assertNotIn('test-key',data);self.assertIn('saved',data);self.assertIn('submissions',data)
 def test_coach_missing_key_opens_settings(self):
  self.open_problem();self.page.get_by_role('button',name='Hint',exact=True).click();expect(self.page.get_by_role('dialog')).to_be_visible()
 def test_hint_progressively_reveals_and_preserves_code(self):
  self.mock_walk();self.get_hint();expect(self.page.get_by_text(WALK['hints'][0],exact=True)).to_be_visible();expect(self.page.get_by_text(WALK['hints'][1],exact=True)).not_to_be_visible();expect(self.page.get_by_text(WALK['solution'],exact=True)).not_to_be_visible()
  self.page.locator('.coach-message summary').filter(has_text='Hint 2').click();expect(self.page.get_by_text(WALK['hints'][1],exact=True)).to_be_visible();self.assertEqual(self.requests[0]['mode'],'hint');self.assertEqual(self.requests[0]['code'],SOURCE);expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('x = 1')
 def test_inline_diff_accept_and_undo(self):
  self.mock_walk();self.get_hint();self.show_edits();expect(self.page.locator('.removed-code')).to_have_text('x = 1');expect(self.page.locator('.added-code')).to_have_text('x = 3');self.page.screenshot(path='/tmp/lab-inline-diff.png',full_page=True)
  self.page.get_by_role('button',name='Accept edit 1',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('x = 3');expect(self.page.locator('.inline-edit')).to_have_count(0)
  self.page.get_by_role('button',name='Undo change',exact=True).click();expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('x = 1')
 def test_inline_diff_reject_preserves_code(self):
  self.mock_walk();self.get_hint();self.show_edits();self.page.get_by_role('button',name='Reject edit 1',exact=True).click();expect(self.page.locator('.inline-edit')).to_have_count(0);expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_contain_text('x = 1')
 def test_inline_diff_multiple_hunks(self):
  walk={**WALK,'edits':WALK['edits']+[{'before':'y = 2','after':'y = 4','explanation':'Change y.'}]};self.mock_walk(walk);self.get_hint();self.show_edits();self.page.get_by_role('button',name='Accept edit 1',exact=True).click();expect(self.page.locator('.inline-edit')).to_have_count(1);self.page.get_by_role('button',name='Reject edit 1',exact=True).click();self.page.wait_for_function("JSON.parse(localStorage.getItem('interview-lab-v1')).ttl.code === 'x = 3\\ny = 2\\nprint(x + y)\\n'")
 def test_editing_invalidates_proposed_diff(self):
  self.mock_walk();self.get_hint();self.show_edits();self.edit('x = 99');expect(self.page.locator('.proposal-banner')).to_contain_text('Your code changed');expect(self.page.get_by_role('button',name='Accept edit 1',exact=True)).to_have_count(0)
 def test_coach_followup_and_navigation_reset(self):
  self.mock_walk();self.get_hint();self.page.get_by_label('Ask your coach').fill('Why that value?');self.page.get_by_role('button',name='Send',exact=True).click();expect(self.page.locator('.coach-message.assistant')).to_have_count(2);self.assertEqual(len(self.requests[1]['messages']),3);self.page.get_by_role('button',name='Follow-up lab',exact=True).click();expect(self.page.locator('.coach-message')).to_have_count(0)
 def test_coach_errors_and_retry(self):
  self.page.route('**/api/coach',lambda r:r.fulfill(status=429,json={'error':'DeepSeek is rate limited. Wait and retry.'}));self.connect();self.open_problem();self.page.get_by_role('button',name='Hint',exact=True).click();expect(self.page.get_by_role('alert')).to_contain_text('rate limited');self.page.unroute('**/api/coach');self.mock_walk();self.page.get_by_role('button',name='Hint',exact=True).click();expect(self.page.get_by_text(WALK['title'],exact=True)).to_be_visible()
 def test_coach_stop(self):
  held=[];self.page.route('**/api/coach',lambda r:held.append(r));self.connect();self.open_problem();self.page.get_by_role('button',name='Hint',exact=True).click();self.page.locator('.coach-panel').get_by_role('button',name='Stop',exact=True).click()
  for route in held:route.abort()
  expect(self.page.locator('.coach-working')).to_have_count(0);expect(self.page.locator('.coach-message')).to_have_count(0)
 def test_coach_renders_markdown(self):
  md='## Plan\n\n1. First **step**\n2. Second\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nSee [docs](https://example.com).\n\n```python\nx = 1\n```'
  self.page.route('**/api/coach',lambda r:r.fulfill(json={'content':md}))
  self.connect();self.open_problem();self.coach();self.page.get_by_label('Ask your coach').fill('Explain');self.page.get_by_role('button',name='Send',exact=True).click()
  msg=self.page.locator('.coach-message.assistant').last
  expect(msg.get_by_role('heading',name='Plan')).to_be_visible();expect(msg.locator('ol > li')).to_have_count(2);expect(msg.locator('strong')).to_contain_text('step')
  expect(msg.locator('table th')).to_have_count(2);expect(msg.locator('a[target="_blank"]')).to_have_attribute('rel','noreferrer');expect(msg.locator('pre code')).to_contain_text('x = 1')
 def test_coach_reports_unmatched_edits(self):
  walk={**WALK,'edits':[]}
  self.page.route('**/api/coach',lambda r:r.fulfill(json={'content':json.dumps(walk),'walkthrough':walk,'droppedEdits':1,'model':'deepseek-flash'}))
  self.connect();self.open_problem();self.edit(SOURCE);self.page.get_by_role('button',name='Hint',exact=True).click()
  expect(self.page.get_by_text(WALK['title'],exact=True)).to_be_visible();self.page.locator('.coach-message summary').filter(has_text='Suggested code edits').click()
  expect(self.page.locator('.coach-message summary').filter(has_text='Suggested code edits').locator('small')).to_contain_text('0 of 1 matched');expect(self.page.locator('.edit-notice')).to_contain_text('did not line up');expect(self.page.get_by_role('button',name='Review edits in editor',exact=True)).to_have_count(0)
 def test_mock_hides_solutions_and_coaching_across_stages(self):
  self.open_problem();self.page.get_by_role('checkbox',name='Mock mode',exact=True).check();self.page.get_by_role('tab',name='Solution',exact=True).click();expect(self.page.get_by_text('Solution hidden during your mock',exact=True)).to_be_visible();self.coach();expect(self.page.get_by_text('Coaching is paused in mock mode.',exact=False)).to_be_visible();self.page.get_by_role('button',name='Follow-up lab',exact=True).click();expect(self.page.get_by_role('checkbox',name='Mock mode',exact=True)).to_be_checked();expect(self.page.get_by_role('button',name='Hint',exact=True)).to_be_disabled()
 def open_design(self,index=0):
  self.page.get_by_role('button',name=f'Design · {len(DESIGNS)}',exact=True).click()
  self.page.get_by_role('button',name='Open '+DESIGNS[index]['title'],exact=True).click()
  self.page.wait_for_timeout(400)
 def answer(self,text='My architecture uses a queue.'):
  box=self.page.get_by_role('textbox',name='Your answer for Scope & requirements',exact=True);box.fill(text);return box
 def mock_grader(self,*verdicts):
  """Reply the way the real route does: score and total are computed from the
  rubric rather than taken from the model, so the mock mirrors that contract."""
  self.grades=[];queue=list(verdicts)
  def respond(route):
   sent=route.request.post_data_json
   self.grades.append(sent)
   body=queue.pop(0) if len(queue)>1 else queue[0]
   if 'error' in body:
    route.fulfill(status=500,json=body)
    return
   total=len(sent.get('rubric') or []);met=len(body.get('met') or [])
   score=round(4*met/total) if total else 0
   route.fulfill(json=dict(body,score=score,met=met,total=total,model='deepseek-flash'))
  self.page.route('**/api/design',respond)
 def test_design_sections_replace_the_single_answer_box(self):
  self.open_design()
  expect(self.page.locator('.design-section-list button')).to_have_count(6)
  expect(self.page.get_by_text('SECTION 1 OF 6',exact=False)).to_be_visible()
  # The grading scheme is visible while practising, not hidden behind a tab.
  expect(self.page.get_by_role('heading',name='What a strong answer covers')).to_be_visible()
  expect(self.page.locator('.design-rubric details')).to_have_count(6)
  # The Python-only chrome is gone from the design track.
  self.assertEqual(self.page.locator('.run-toolbar').count(),0)
  self.assertEqual(self.page.get_by_role('tab',name='Submissions',exact=True).count(),0)
  expect(self.page.get_by_role('tab',name='Report',exact=True)).to_be_visible()
 def test_design_interviewer_asks_a_follow_up_until_the_section_holds(self):
  self.mock_grader({'met':['r1'],'strengths':['Named the submit path.'],'gaps':['No durability boundary.'],'followUp':'What makes a submission accepted?'},
                   {'met':['r1','r2','r3'],'strengths':['Named the submit path.','Stated the guarantee.','Scoped out the runtime.'],'gaps':[],'followUp':''})
  self.connect();self.open_design();self.answer('I would put a queue in front of workers.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  expect(self.page.get_by_text('What makes a submission accepted?')).to_be_visible()
  # The grader was sent this scenario's rubric, not a generic one.
  rubric=self.grades[0]['rubric'];self.assertEqual(len(rubric),3)
  self.assertIn('training',rubric[2].lower())
  self.assertNotIn('side effect',str(rubric).lower())
  self.assertEqual(self.grades[0]['section'],'scope')
  self.assertEqual(self.grades[0]['probes'],[p['question'] for p in DESIGNS[0]['probes'] if p['section']=='scope'])
  self.page.get_by_label('Your answer to the follow-up',exact=True).fill('A transactional outbox.')
  self.page.get_by_role('button',name='Answer the follow-up',exact=True).click()
  expect(self.page.get_by_text('Section accepted',exact=False)).to_be_visible()
  # The second call replays the whole exchange, not just the reply.
  self.assertEqual(self.grades[1]['turns'],[{'question':'What makes a submission accepted?','answer':'A transactional outbox.'}])
  self.assertIn('I would put a queue in front of workers.',self.grades[1]['answer'])
  self.assertFalse(self.grades[1]['lastChance'])
  stored=self.page.evaluate('JSON.parse(localStorage.getItem("interview-lab-v1"))')[DESIGNS[0]['id']]['design']['sections']['scope']
  self.assertEqual(stored['turns'][0]['score'],4)
  self.assertTrue(stored['grade']['passed'])
  self.assertIsNone(stored.get('pending'))
 def test_follow_up_budget_is_capped_and_then_reveals_the_reference(self):
  ask={'met':[],'strengths':[],'gaps':['Still thin.'],'followUp':'Again, more detail please.'}
  self.mock_grader(ask)
  self.connect();self.open_design();self.answer('A queue.')
  for i in range(3):
   self.page.get_by_role('button',name='Submit for review',exact=True).click() if i==0 else None
   if i==0: expect(self.page.get_by_text('Again, more detail please.')).to_be_visible()
   self.page.get_by_label('Your answer to the follow-up',exact=True).fill(f'Reply {i}.')
   self.page.get_by_role('button',name='Answer the follow-up',exact=True).click()
   expect(self.page.locator('.design-pending')).to_have_count(0 if i==2 else 1)
  expect(self.page.get_by_text('Follow-up budget spent',exact=False)).to_be_visible()
  expect(self.page.get_by_text('Compare with a strong answer')).to_be_visible()
  stored=self.page.evaluate('JSON.parse(localStorage.getItem("interview-lab-v1"))')[DESIGNS[0]['id']]['design']['sections']['scope']
  self.assertEqual(len(stored['turns']),3)
  self.assertIsNone(stored.get('pending'))
  self.assertFalse(stored['grade']['passed'])
 def test_a_failed_grading_costs_nothing_and_can_be_retried(self):
  self.mock_grader({'error':'DeepSeek is unavailable right now. Please try again.'},
                   {'met':['r1','r2','r3'],'strengths':['Good.'],'gaps':[],'followUp':''})
  self.connect();self.open_design();self.answer('A queue.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  expect(self.page.get_by_role('alert')).to_contain_text('unavailable')
  # The answer is kept, but no grade and no follow-up were recorded.
  scope=self.page.evaluate('(id) => JSON.parse(localStorage.getItem("interview-lab-v1"))[id].design.sections.scope',DESIGNS[0]['id'])
  self.assertEqual(scope['answer'],'A queue.')
  self.assertIsNone(scope.get('grade'))
  self.assertEqual(scope['turns'],[])
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  expect(self.page.get_by_text('Section accepted',exact=False)).to_be_visible()
 def test_failure_scenarios_are_injected_at_their_own_section(self):
  self.open_design()
  # design-inference injects its capacity loss in the failure section.
  self.page.locator('.design-section-list button').filter(has_text='Failure & tradeoffs').click()
  expect(self.page.locator('.design-injected')).to_contain_text('GPU pool loses 30%')
  self.page.locator('.design-section-list button').filter(has_text='Scope & requirements').click()
  expect(self.page.locator('.design-injected')).to_have_count(0)
 def test_design_report_separates_rubric_score_from_guidance(self):
  graded={'scope':{'answer':'a','turns':[],'grade':{'score':4,'met':3,'total':3,'strengths':[],'gaps':[],'passed':True}},
          'estimates':{'answer':'a','turns':[{'question':'q','answer':'a','score':1,'met':1,'total':3}],'grade':{'score':1,'met':1,'total':3,'strengths':[],'gaps':['No arithmetic shown.'],'passed':False}}}
  self.seed({DESIGNS[1]['id']:{'design':{'sections':graded}}});self.open_design(1)
  self.page.get_by_role('tab',name='Report',exact=True).click()
  expect(self.page.get_by_text('Interview report')).to_be_visible()
  expect(self.page.locator('.design-report tbody tr')).to_have_count(2)
  expect(self.page.locator('.design-report')).to_contain_text('Reached unaided')
  expect(self.page.locator('.design-report')).to_contain_text('1 follow-up')
  expect(self.page.locator('.design-report')).to_contain_text('No arithmetic shown.')
  expect(self.page.locator('.design-totals')).to_contain_text('5')
  # Still in progress, because the follow-up budget was not spent.
  self.page.get_by_role('button',name='Problems',exact=True).click()
  self.page.get_by_label('Filter by status').select_option('In progress')
  expect(self.page.locator('.problem-table tbody tr')).to_have_count(1)
 def test_follow_up_questions_are_in_the_question_tab(self):
  self.open_design(1)
  expect(self.page.get_by_role('heading',name='Follow-up questions',exact=True)).to_be_visible()
  # Grouped by the section that asks them, so the list reads in interview order.
  blocks=self.page.locator('.design-probes details')
  self.assertGreater(blocks.count(),0)
  for i in range(blocks.count()):
   blocks.nth(i).locator('summary').click()
  listed=self.page.locator('.design-probes li')
  self.assertEqual(listed.count(),len(DESIGNS[1]['probes']))
  for q in DESIGNS[1]['probes']:
   expect(self.page.locator('.design-probes')).to_contain_text(q['question'][:40])
  # The question says where the answers live.
  expect(self.page.locator('.design-probes')).to_contain_text('Solution tab')
 def test_every_follow_up_question_has_a_worked_answer_in_the_solution_tab(self):
  self.open_design(1)
  self.page.get_by_role('tab',name='Solution',exact=True).click()
  answers=json.loads((ROOT/'app/data/design-answers.json').read_text())
  expected={a['id']:a for a in answers}[DESIGNS[1]['id']]['probes']
  for p in DESIGNS[1]['probes']:
   block=self.page.locator('.design-probe-answer').filter(has_text=p['question'][:40])
   expect(block).to_have_count(1)
   # The worked answer is present, not a placeholder.
   answer=next(a for a in expected if a['question']==p['question'])['answer']
   self.assertGreater(len(answer),80,f'probe answer too thin: {p["question"]}')
   expect(block).to_contain_text(answer.split('.')[0][:40])
  # Every section labels its material so a worked answer is never mistaken for
  # the reference answer.
  expect(self.page.locator('.design-solution-block h3').filter(has_text='Follow-up questions').first).to_be_visible()
 def test_the_solution_tab_still_hides_everything_in_mock_mode(self):
  self.open_design(1)
  self.page.get_by_role('tab',name='Solution',exact=True).click()
  expect(self.page.locator('.design-solution section')).to_have_count(6)
  # The questions stay visible while practising; only the answers are withheld.
  self.page.get_by_role('tab',name='Question',exact=True).click()
  expect(self.page.get_by_role('heading',name='Follow-up questions',exact=True)).to_be_visible()
  self.page.get_by_role('checkbox',name='Mock mode',exact=True).check()
  self.page.get_by_role('tab',name='Solution',exact=True).click()
  expect(self.page.get_by_text('Solution hidden during your mock',exact=False)).to_be_visible()
  self.assertEqual(self.page.locator('.design-solution section').count(),0)
  self.assertEqual(self.page.locator('.design-probe-answer').count(),0)
 def test_design_reference_answers_are_hidden_in_mock_mode(self):
  self.open_design()
  self.page.get_by_role('tab',name='Solution',exact=True).click()
  expect(self.page.get_by_role('heading',name='Reference answers')).to_be_visible()
  # One reference per section, and a worked answer for every follow-up.
  expect(self.page.locator('.design-solution section')).to_have_count(6)
  self.assertEqual(self.page.locator('.design-probe-answer').count(),len(DESIGNS[0]['probes']))
  self.assertEqual(self.page.get_by_text('No answer recorded for this.',exact=True).count(),0)
  self.page.get_by_role('checkbox',name='Mock mode',exact=True).check()
  expect(self.page.get_by_text('Solution hidden during your mock',exact=False)).to_be_visible()
  self.assertEqual(self.page.locator('.design-solution section').count(),0)
 def test_old_single_design_answer_becomes_the_first_section(self):
  self.seed({DESIGNS[2]['id']:{'answer':'My previous design write-up.'}});self.open_design(2)
  expect(self.page.get_by_role('textbox',name='Your answer for Scope & requirements',exact=True)).to_have_value('My previous design write-up.')
  # Nothing was thrown away: the old single-answer field is still readable.
  self.assertEqual(self.page.evaluate('(id) => JSON.parse(localStorage.getItem("interview-lab-v1"))[id].answer',DESIGNS[2]['id']),'My previous design write-up.')
 def test_design_connection_and_answer_limit_are_visible(self):
  self.open_design()
  expect(self.page.locator('.design-flow-intro')).to_contain_text('one section at a time')
  self.page.get_by_role('button',name='Connect DeepSeek',exact=True).click()
  self.page.get_by_label('DeepSeek API key',exact=True).fill('test-key-not-real')
  self.page.get_by_role('button',name='Save API key').click()
  expect(self.page.get_by_role('button',name='DeepSeek key saved',exact=True)).to_be_visible()
  box=self.answer('x'*8000)
  expect(box).to_have_attribute('maxlength','8000')
  expect(self.page.locator('#design-answer-count')).to_contain_text('8,000 / 8,000')
 def test_design_coach_uses_interview_actions_and_followup_context(self):
  self.mock_grader({'met':[],'strengths':[],'gaps':['Explain durability.'],'followUp':'What commits acceptance?'},
                   {'met':['r1'],'strengths':['Stable ID.'],'gaps':['No write boundary.'],'followUp':'Which durable write?'})
  requests=[]
  def respond(route):
   requests.append(route.request.post_data_json)
   route.fulfill(json={'content':'Choose the acceptance boundary explicitly.'})
  self.page.route('**/api/coach',respond)
  self.connect();self.open_design(1);self.answer('A durable queue.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  self.page.get_by_label('Your answer to the follow-up',exact=True).fill('Retry with one stable job ID.')
  self.page.get_by_role('button',name='Answer the follow-up',exact=True).click()
  expect(self.page.locator('.design-pending')).to_contain_text('Which durable write?')
  self.coach()
  expect(self.page.get_by_role('heading',name='Your design coach',exact=True)).to_be_visible()
  self.page.get_by_role('button',name='Review my design',exact=True).click()
  expect(self.page.locator('.coach-message.assistant')).to_contain_text('acceptance boundary')
  self.assertIn('Retry with one stable job ID.',requests[-1]['context'])
  self.assertIn('Which durable write?',requests[-1]['context'])
  self.assertIn('No write boundary.',requests[-1]['context'])
  self.assertNotIn('code',requests[-1]['messages'][-1]['content'])
 def test_failed_followup_reply_survives_navigation_reload_and_retry(self):
  self.mock_grader({'met':[],'strengths':[],'gaps':['Explain durability.'],'followUp':'What commits the job?'},
                   {'error':'Temporarily unavailable.'},
                   {'met':['r1','r2','r3'],'strengths':['Durable.'],'gaps':[],'followUp':''})
  self.connect();self.open_design();self.answer('A queue.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  reply=self.page.get_by_label('Your answer to the follow-up',exact=True)
  reply.fill('Keep this transactional outbox explanation.')
  self.page.get_by_role('button',name='Answer the follow-up',exact=True).click()
  expect(self.page.get_by_role('alert')).to_contain_text('unavailable')
  expect(reply).to_have_value('Keep this transactional outbox explanation.')
  self.page.locator('.design-section-list button').filter(has_text='Scale & estimates').click()
  self.page.locator('.design-section-list button').filter(has_text='Scope & requirements').click()
  expect(reply).to_have_value('Keep this transactional outbox explanation.')
  self.page.reload()
  expect(reply).to_have_value('Keep this transactional outbox explanation.')
  self.page.get_by_role('button',name='Answer the follow-up',exact=True).click()
  expect(self.page.get_by_text('Section accepted',exact=False)).to_be_visible()
  self.assertEqual(self.grades[-1]['turns'][0]['answer'],'Keep this transactional outbox explanation.')
 def test_design_coach_bounds_long_interview_context(self):
  sections={}
  for section in ['scope','estimates','data','flow','failure','ops']:
   sections[section]={'answer':'a'*8000,'turns':[{'question':'Retry question?','answer':'b'*8000,'score':1,'met':1,'total':3} for _ in range(3)]}
  self.seed({DESIGNS[1]['id']:{'design':{'sections':sections}}})
  requests=[]
  def respond(route):
   requests.append(route.request.post_data_json);route.fulfill(json={'content':'The interview context arrived.'})
  self.page.route('**/api/coach',respond)
  self.connect();self.open_design(1);self.coach()
  self.page.get_by_role('button',name='Review my design',exact=True).click()
  expect(self.page.locator('.coach-message.assistant')).to_contain_text('context arrived')
  self.assertLessEqual(len(requests[0]['context']),60000)
  self.assertIn('Operations & observability',requests[0]['context'])
  self.assertIn('shortened for the coach',requests[0]['context'])
 def test_mock_mode_blocks_a_pending_followup_request(self):
  self.mock_grader({'met':[],'strengths':[],'gaps':[],'followUp':'Why a queue?'})
  self.connect();self.open_design();self.answer('A queue.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  self.page.get_by_label('Your answer to the follow-up',exact=True).fill('A durable queue.')
  self.page.get_by_role('checkbox',name='Mock mode',exact=True).check()
  expect(self.page.get_by_role('button',name='Answer the follow-up',exact=True)).to_be_disabled()
  expect(self.page.locator('.design-grade')).to_have_count(0)
  self.assertEqual(len(self.grades),1)
 def test_revising_a_design_answer_clears_stale_feedback(self):
  self.mock_grader({'met':[],'strengths':[],'gaps':['Old feedback.'],'followUp':'Old question?'})
  self.connect();self.open_design();self.answer('Original answer.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  expect(self.page.locator('.design-grade')).to_contain_text('Old feedback.')
  self.answer('Revised answer.')
  expect(self.page.locator('.design-grade')).to_have_count(0)
  expect(self.page.locator('.design-pending')).to_have_count(0)
  expect(self.page.get_by_role('button',name='Submit for review',exact=True)).to_be_enabled()
  self.page.reload()
  expect(self.page.locator('.design-grade')).to_have_count(0)
  expect(self.page.get_by_label('Your answer for Scope & requirements',exact=True)).to_have_value('Revised answer.')
 def test_section_navigation_is_disabled_during_design_review(self):
  waiting=[]
  self.page.route('**/api/design',lambda route:waiting.append(route))
  self.connect();self.open_design();self.answer('Keep this answer in scope.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  expect(self.page.get_by_role('button',name='Reviewing…',exact=True)).to_be_disabled()
  for button in self.page.locator('.design-section-list button').all():
   expect(button).to_be_disabled()
  expect(self.page.get_by_role('button',name='Next: Scale & estimates',exact=False)).to_be_disabled()
  self.assertEqual(len(waiting),1)
  waiting[0].fulfill(json={'score':4,'met':3,'total':3,'strengths':['Good.'],'gaps':[],'followUp':''})
  expect(self.page.get_by_text('Section accepted',exact=False)).to_be_visible()
  self.page.locator('.design-section-list button').filter(has_text='Scale & estimates').click()
  expect(self.page.get_by_label('Your answer for Scale & estimates',exact=True)).to_have_value('')
  scope=self.page.evaluate('(id) => JSON.parse(localStorage.getItem("interview-lab-v1"))[id].design.sections.scope',DESIGNS[0]['id'])
  self.assertEqual(scope['answer'],'Keep this answer in scope.')
  self.assertTrue(scope['grade']['passed'])
 def test_design_rejects_an_answer_with_no_key(self):
  self.open_design();self.answer('A queue.')
  self.page.get_by_role('button',name='Submit for review',exact=True).click()
  expect(self.page.get_by_role('dialog')).to_be_visible()
  expect(self.page.get_by_role('dialog')).to_contain_text('DeepSeek API key')
 def test_design_grader_rejects_a_missing_key(self):
  r=self.context.request.post(URL+'/api/design',data={'problemId':'design-jobs','section':'scope','title':'t','prompt':'p','answer':'a','rubric':['x'],'probes':[],'failures':[],'turns':[],'lastChance':False})
  self.assertEqual(r.status,401)
 def test_timer_and_stdin_survive_a_stage_switch(self):
  self.open_problem();self.page.get_by_role('button',name='Start timer',exact=True).click();expect(self.page.locator('.timer-value')).not_to_have_text('60:00',timeout=4000)
  self.page.get_by_role('button',name='Console',exact=False).click();self.page.locator('summary').filter(has_text='Scratch code & standard input').click();self.page.get_by_label('Standard input',exact=True).fill('carry me')
  self.page.get_by_role('button',name='Follow-up lab',exact=True).click();expect(self.page.locator('.timer-value')).not_to_have_text('60:00')
  self.page.get_by_role('button',name='Base problem',exact=True).click();self.page.get_by_role('button',name='Console',exact=False).click();self.page.locator('summary').filter(has_text='Scratch code & standard input').click()
  expect(self.page.get_by_label('Standard input',exact=True)).to_have_value('carry me')
 def test_failed_assertion_explains_itself(self):
  self.open_problem();self.edit(CODING[0]['starter']);self.page.get_by_role('button',name='Run',exact=True).click()
  out=self.page.locator('.failure-output').first;expect(out).to_be_visible(timeout=90000)
  expect(out).to_contain_text('Failed:');expect(out).to_contain_text('left  = ');expect(out).to_contain_text('right = ')
  expect(self.page.locator('.output-status strong')).to_contain_text('Wrong Answer')
 def test_enter_sends_and_shift_enter_newlines(self):
  self.mock_walk();self.connect();self.open_problem();self.coach();box=self.page.get_by_label('Ask your coach')
  box.click();box.type('first line');box.press('Shift+Enter');box.type('second line')
  self.assertEqual(box.input_value(),'first line\nsecond line');self.assertEqual(len(self.requests),0)
  box.press('Enter');self.page.wait_for_timeout(300)
  self.assertEqual(len(self.requests),1);expect(self.page.get_by_text('first line',exact=False)).to_be_visible()
  self.assertEqual(box.input_value(),'')
 def test_typing_shows_the_question_while_the_coach_works(self):
  held=[]
  self.page.route('**/api/coach',lambda r:held.append(r));self.connect();self.open_problem();self.coach()
  self.page.get_by_label('Ask your coach').fill('Why that value?')
  self.page.get_by_label('Ask your coach').press('Enter');self.page.wait_for_timeout(400)
  expect(self.page.locator('.coach-message.user')).to_contain_text('Why that value?');expect(self.page.locator('.coach-dots i')).to_have_count(3);expect(self.page.locator('.coach-working')).to_contain_text('Reviewing')
  self.page.locator('.coach-panel').get_by_role('button',name='Stop',exact=True).click()
  for route in held:route.abort()
 def test_a_failed_request_keeps_the_question(self):
  self.page.route('**/api/coach',lambda r:r.fulfill(status=500,json={'error':'DeepSeek is unavailable right now. Please try again.'}))
  self.connect();self.open_problem();self.coach();self.page.get_by_label('Ask your coach').fill('Does this survive?')
  self.page.get_by_label('Ask your coach').press('Enter')
  expect(self.page.get_by_role('alert')).to_contain_text('unavailable');expect(self.page.locator('.coach-message.user')).to_contain_text('Does this survive?')
 def test_panes_scroll_inside_their_container(self):
  self.open_problem();self.page.get_by_role('button',name='Console',exact=False).click()
  for sel in ['.question-scroll','.console-scroll']:
   el=self.page.locator(sel);expect(el).to_be_visible()
   self.assertGreater(el.evaluate('e=>e.scrollHeight'),el.evaluate('e=>e.clientHeight'),f'{sel} should overflow')
   self.assertTrue(el.evaluate('e=>{const b=e.scrollTop;e.scrollTop=99999;const a=e.scrollTop;e.scrollTop=b;return a-b>0}'),f'{sel} should scroll')
 def test_theme_and_responsive_layout(self):
  self.page.get_by_role('button',name='Use dark theme',exact=True).click();self.page.reload();expect(self.page.locator('html')).to_have_class('dark');self.page.get_by_role('button',name='Use light theme',exact=True).click()
  for width in [390,768,1440]:self.page.set_viewport_size({'width':width,'height':900});self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
  self.open_problem()
  for width in [390,768,1440]:
   self.page.set_viewport_size({'width':width,'height':900});self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width);expect(self.page.get_by_role('button',name='Submit',exact=True)).to_be_visible()
  self.page.set_viewport_size({'width':390,'height':844});self.page.screenshot(path='/tmp/lab-mobile-v2.png',full_page=True)
 def test_question_and_solution_content(self):
  self.open_problem();expect(self.page.get_by_role('heading',name='Requirements & constraints')).to_be_visible();expect(self.page.locator('.problem-example')).to_have_count(2);self.page.get_by_role('tab',name='Solution',exact=True).click();expect(self.page.get_by_role('heading',name='Approach',exact=True)).to_be_visible();expect(self.page.get_by_role('textbox',name='Reference solution',exact=True)).to_contain_text('class TTLStore')
  self.page.get_by_role('button',name='Follow-up lab',exact=True).click();expect(self.page.locator('.problem-example')).to_have_count(1);expect(self.page.locator('.example-box')).to_contain_text('snapshot');expect(self.page.get_by_text('Inspect the tests for concrete',exact=False)).to_have_count(0)
 def editor_text(self):
  return self.page.evaluate("document.querySelector('.python-editor .cm-content').textContent")
 def editor_text(self):
  return self.page.evaluate("document.querySelector('.python-editor .cm-content').textContent")
 def assist_toggle(self):
  return self.page.get_by_role('button',name='Autocomplete',exact=False)
 def test_autocomplete_is_off_by_default_and_says_so(self):
  self.open_problem()
  expect(self.assist_toggle()).to_have_attribute('aria-pressed','false')
  self.assertIn('Off',self.assist_toggle().inner_text())
  box=self.page.get_by_role('textbox',name='Python code',exact=True);box.click();box.fill('')
  box.type('de');self.page.wait_for_timeout(700)
  self.assertEqual(self.page.locator('.cm-tooltip-autocomplete').count(),0,'completions appeared while the toggle was off')
  # Closing brackets is unconditional and deliberately outside the toggle.
  box.fill('');box.type('print(');self.page.wait_for_timeout(300)
  self.assertEqual(self.editor_text(),'print()')
  box.fill('');box.type('x = "a');self.page.wait_for_timeout(300)
  self.assertEqual(self.editor_text(),'x = "a"')
 def test_turning_autocomplete_on_gives_completions(self):
  self.open_problem();self.assist_toggle().click();self.page.wait_for_timeout(300)
  expect(self.assist_toggle()).to_have_attribute('aria-pressed','true')
  self.assertIn('On',self.assist_toggle().inner_text())
  box=self.page.get_by_role('textbox',name='Python code',exact=True);box.click();box.fill('')
  box.type('de');self.page.wait_for_timeout(700)
  options=self.page.locator('.cm-tooltip-autocomplete li').all_inner_texts()
  self.assertTrue(any('def' in o for o in options),f'expected a def completion, got {options}')
  self.page.keyboard.press('Escape');box.fill('')
  # Structural snippets come from the language, not from a hand-written list.
  box.type('for');self.page.wait_for_timeout(700)
  self.page.locator('.cm-tooltip-autocomplete li').first.click();self.page.wait_for_timeout(300)
  self.assertIn('for name in collection:',self.editor_text())
  box.fill('');box.type('import heap');self.page.wait_for_timeout(700)
  self.assertIn('heap',str(self.page.locator('.cm-tooltip-autocomplete li').all_inner_texts()))
 def test_brackets_close_whether_or_not_the_toggle_is_on(self):
  self.open_problem()
  for pressed in ('false','true'):
   if self.assist_toggle().get_attribute('aria-pressed')!=pressed:self.assist_toggle().click();self.page.wait_for_timeout(300)
   box=self.page.get_by_role('textbox',name='Python code',exact=True);box.click();box.fill('')
   box.type('f(1, [2]');self.page.wait_for_timeout(300)
   self.assertEqual(self.editor_text(),'f(1, [2])',f'brackets did not close with the toggle {pressed}')
   box.fill('');box.type('d = {"k": 1');self.page.wait_for_timeout(300)
   self.assertEqual(self.editor_text(),'d = {"k": 1}',f'braces/quotes did not close with the toggle {pressed}')
 def test_the_autocomplete_choice_survives_a_refresh(self):
  self.open_problem();self.assist_toggle().click();self.page.wait_for_timeout(300)
  self.assertEqual(self.page.evaluate("localStorage.getItem('interview-lab-autocomplete')"),'on')
  self.page.reload();self.page.wait_for_timeout(700)
  expect(self.assist_toggle()).to_have_attribute('aria-pressed','true')
  self.page.reload();self.page.wait_for_timeout(700)
  expect(self.assist_toggle()).to_have_attribute('aria-pressed','true')
 def test_turning_autocomplete_back_off_works(self):
  self.open_problem();self.assist_toggle().click();self.page.wait_for_timeout(300);self.assist_toggle().click();self.page.wait_for_timeout(300)
  expect(self.assist_toggle()).to_have_attribute('aria-pressed','false')
  box=self.page.get_by_role('textbox',name='Python code',exact=True);box.click();box.fill('')
  box.type('de');self.page.wait_for_timeout(700)
  self.assertEqual(self.page.locator('.cm-tooltip-autocomplete').count(),0)
  self.assertEqual(self.page.evaluate("localStorage.getItem('interview-lab-autocomplete')"),'off')
 def test_the_design_track_has_no_autocomplete_toggle(self):
  self.open_design()
  self.assertEqual(self.assist_toggle().count(),0)
 def test_read_only_example_viewers_get_no_completions(self):
  self.open_problem();self.page.get_by_role('tab',name='Solution',exact=True).click();self.page.wait_for_timeout(500)
  self.page.locator('.python-example').first.click();self.page.wait_for_timeout(300)
  self.page.keyboard.type('de');self.page.wait_for_timeout(700)
  self.assertEqual(self.page.locator('.cm-tooltip-autocomplete').count(),0)
 def test_light_mode_distinguishes_token_kinds(self):
  self.open_problem()
  box=self.page.get_by_role('textbox',name='Python code',exact=True)
  box.fill('class T:\n    def go(self, limit):\n        self.limit = limit\n        return "s"\n')
  self.page.wait_for_timeout(400)
  # Stock CodeMirror paints every keyword one magenta and cannot tell a
  # property from a plain local. Assert the distinctions that matter instead of
  # counting colours, so this cannot pass by accident.
  colours=self.page.evaluate("""() => {
    const want={keyword:'def',property:'self',number:null,string:'"s"'};
    const out={};
    for (const s of document.querySelectorAll('.python-editor .cm-content span')) {
      const t=s.textContent;
      if (t==='def') out.keyword=getComputedStyle(s).color;
      if (t==='self') out.property=getComputedStyle(s).color;
      if (t==='"s"') out.string=getComputedStyle(s).color;
    }
    return out;
  }""")
  self.assertTrue(colours.get('keyword'),'no keyword span found')
  self.assertTrue(colours.get('property'),'no self span found')
  self.assertTrue(colours.get('string'),'no string span found')
  self.assertNotEqual(colours['keyword'],colours['string'],'keyword and string share a colour')
  self.assertNotEqual(colours['property'],colours['string'],'self and string share a colour')
 def url(self):
  return self.page.evaluate('location.search')
 def test_refresh_keeps_you_on_the_same_problem_and_stage(self):
  self.open_problem();self.page.get_by_role('button',name='Follow-up lab',exact=True).click();self.page.wait_for_timeout(300)
  self.assertIn('view=problem',self.url());self.assertIn('id=ttl',self.url());self.assertIn('stage=followup',self.url())
  self.page.reload();self.page.wait_for_timeout(600)
  # Back on the same problem, same stage, with no need to re-open it.
  expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_be_visible()
  expect(self.page.get_by_role('button',name='Follow-up lab',exact=True)).to_have_attribute('aria-pressed','true')
  followups=json.loads((ROOT/'app/data/followups.json').read_text())
  self.assertEqual(self.page.evaluate('document.querySelector(".question-title h1").textContent'),followups[0]['title'])
 def test_a_deep_link_opens_that_problem_directly(self):
  self.page.goto(URL+'?view=problem&id=limiter&stage=followup');self.page.wait_for_load_state('networkidle');self.page.wait_for_timeout(500)
  expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_be_visible()
  followups=json.loads((ROOT/'app/data/followups.json').read_text())
  self.assertEqual(self.page.evaluate('document.querySelector(".question-title h1").textContent'),followups[1]['title'])
  expect(self.page.get_by_role('button',name='Follow-up lab',exact=True)).to_have_attribute('aria-pressed','true')
 def test_a_deep_link_into_the_design_track_opens_the_interview(self):
  self.page.goto(URL+'?view=problem&track=design&id='+DESIGNS[3]['id']);self.page.wait_for_load_state('networkidle');self.page.wait_for_timeout(500)
  expect(self.page.locator('.design-section-list button')).to_have_count(6)
  self.assertEqual(self.page.evaluate('document.querySelector(".question-title h1").textContent'),DESIGNS[3]['title'])
 def test_a_stale_deep_link_falls_back_instead_of_rendering_nothing(self):
  self.page.goto(URL+'?view=problem&id=deleted-problem');self.page.wait_for_load_state('networkidle');self.page.wait_for_timeout(600)
  expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_be_visible()
  self.assertEqual(self.page.evaluate('document.querySelector(".question-title h1").textContent'),CODING[0]['title'])
  expect(self.page.get_by_role('button',name='Base problem',exact=True)).to_have_attribute('aria-pressed','true')
 def test_a_stale_link_cannot_smuggle_a_design_problem_into_a_follow_up_stage(self):
  self.page.goto(URL+'?view=problem&track=design&id=deleted&stage=followup');self.page.wait_for_load_state('networkidle');self.page.wait_for_timeout(600)
  expect(self.page.locator('.design-section-list button')).to_have_count(6)
  self.assertEqual(self.page.evaluate('document.querySelector(".question-title h1").textContent'),DESIGNS[0]['title'])
  self.assertNotIn('stage=',self.url())
 def test_back_returns_to_the_library_and_forward_returns_to_the_problem(self):
  self.open_problem();self.page.wait_for_timeout(300)
  # History is now: library, problem, library. Back from the library returns
  # to the problem, which is what a browser user expects.
  self.page.get_by_role('button',name='Problems',exact=True).click();self.page.wait_for_timeout(300)
  expect(self.page.locator('.problem-library')).to_be_visible()
  self.page.go_back();self.page.wait_for_timeout(600)
  expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_be_visible()
  self.page.go_forward();self.page.wait_for_timeout(600)
  expect(self.page.locator('.problem-library')).to_be_visible()
 def test_typing_in_a_filter_does_not_fill_up_the_history(self):
  self.open_problem();self.page.wait_for_timeout(300);self.page.get_by_role('button',name='Problems',exact=True).click();self.page.wait_for_timeout(300)
  before=self.page.evaluate('history.length')
  self.page.get_by_label('Search library').fill('l');self.page.get_by_label('Search library').fill('li');self.page.get_by_label('Search library').fill('lim');self.page.wait_for_timeout(300)
  self.assertEqual(self.page.evaluate('history.length'),before,'each keystroke pushed a history entry')
  self.assertIn('q=lim',self.url())
  # One Back returns to the problem, not to the previous keystroke.
  self.page.go_back();self.page.wait_for_timeout(500)
  expect(self.page.get_by_role('textbox',name='Python code',exact=True)).to_be_visible()
 def test_library_filters_survive_a_refresh(self):
  self.page.get_by_label('Filter by topic').select_option('Graphs');self.page.get_by_label('Search library').fill('shortest');self.page.wait_for_timeout(300)
  self.assertIn('topic=Graphs',self.url());self.assertIn('q=shortest',self.url())
  self.page.reload();self.page.wait_for_load_state('networkidle');self.page.wait_for_timeout(500)
  self.assertEqual(self.page.get_by_label('Filter by topic').input_value(),'Graphs')
  self.assertEqual(self.page.get_by_label('Search library').input_value(),'shortest')
  expect(self.page.locator('.problem-table tbody tr')).to_have_count(1)
 def test_the_library_url_stays_clean(self):
  expect(self.page.locator('.problem-library')).to_be_visible()
  self.assertEqual(self.url(),'','a pristine library should not carry a query string')
 def select_first_line_word(self):
  """Select a word and return the selection rectangle in page coordinates."""
  box=self.page.locator('.cm-editor').first.bounding_box()
  self.page.mouse.dblclick(box['x']+110,box['y']+12+11)
  self.page.wait_for_timeout(400)
  return self.page.evaluate("""() => {
    const sel=document.querySelector('.python-editor .cm-selectionLayer .cm-selectionBackground');
    if(!sel) return null;
    const r=sel.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,
            bg:getComputedStyle(sel).backgroundColor,
            text:String(getSelection())};
  }""")
 def test_a_selection_is_not_occluded_by_the_caret_line(self):
  """CodeMirror paints the selection at z-index -2, behind the text, so any
  opaque .cm-line background hides it. A full-width active-line fill hid the
  selection on the caret line entirely, which is where it always is. Two colour
  changes did not fix it because the selection was not faint, it was covered."""
  self.open_problem()
  sel=self.select_first_line_word()
  self.assertIsNotNone(sel,'nothing was selected')
  self.assertTrue(sel['text'].strip(),'the selection was empty')
  # The caret is on the line we just selected, so this is the worst case.
  on_caret=self.page.evaluate("""() => {
    const active=document.querySelector('.cm-activeLine');
    return active?getComputedStyle(active).backgroundColor:'none';
  }""")
  self.assertIn(on_caret,('rgba(0, 0, 0, 0)','transparent'),
    f'the caret line is still an opaque fill ({on_caret}) and will cover the selection')
  # Nothing opaque may be painted over the middle of the selection.
  top=self.page.evaluate("""(p) => {
    const e=document.elementFromPoint(p.x,p.y);
    let chain=[],n=e;
    while(n&&n!==document.body){chain.push(getComputedStyle(n).backgroundColor);n=n.parentElement;}
    return chain;
  }""", sel)
  self.assertNotIn('rgb(28, 31, 39)',top,f'something opaque covers the selection: {top}')
 def test_the_selection_is_saturated_enough_to_read_at_a_glance(self):
  """Real editors sit at 1.4-1.9:1, so lightness alone is not what makes a
  selection read; a saturated hue against a neutral background is."""
  self.open_problem()
  for theme,label in ((False,'light'),(True,'dark')):
   if theme: self.page.get_by_role('button',name='Use dark theme',exact=True).click();self.page.wait_for_timeout(600)
   sel=self.select_first_line_word()
   self.assertIsNotNone(sel,f'no selection in {label} mode')
   n=[int(x) for x in re.findall('[0-9]+',sel['bg'])][:3]
   self.assertEqual(len(n),3,f'could not read {sel["bg"]!r}')
   r,g,b=[c/255 for c in n]
   hi,lo=max(r,g,b),min(r,g,b)
   self.assertGreater((hi-lo)/hi,0.40,f'{label} selection {sel["bg"]} is not saturated enough to read at a glance')
 def test_every_coding_follow_up_shows_its_answer_in_the_solution_tab(self):
  """These were collapsed, so the section read as a list of questions with no
  solutions. An answer hidden behind a disclosure is an answer nobody reads."""
  self.open_problem();self.page.get_by_role('tab',name='Solution',exact=True).click()
  followups=json.loads((ROOT/'app/data/followups.json').read_text())
  expected=followups[0]['answers']
  self.assertEqual(self.page.locator('.followup-block').count(),len(expected))
  # Nothing in the Solution tab is behind a collapsed disclosure.
  self.assertEqual(self.page.locator('.question-pane details').count(),0)
  for i,a in enumerate(expected):
   block=self.page.locator('.followup-block').nth(i)
   expect(block).to_contain_text(a['question'])
   self.assertGreater(len(a['answer']),60,f'thin answer: {a["question"]}')
   expect(block).to_contain_text(a['answer'].split('.')[0][:40])
   for c in a['checks']:
    expect(block).to_contain_text(c)
 def test_the_first_paint_is_already_the_right_view_and_theme(self):
  """A useEffect cannot run before paint, so the server-rendered library used
  to flash on every deep link and the stored theme flashed too. A blocking
  script in the head fixes both."""
  self.open_problem()
  self.page.get_by_role('button',name='Follow-up lab',exact=True).click();self.page.wait_for_timeout(400)
  deep=self.page.evaluate('location.search')
  for dark,label in ((True,'dark'),(False,'light')):
   # Set the preference, then load the deep link and inspect the first paint.
   self.page.evaluate("(on)=>localStorage.setItem('interview-lab-theme',on?'dark':'light')",dark)
   self.page.goto(URL+deep,wait_until='commit')
   first=self.page.evaluate("""() => {
     const d=document.documentElement;
     const lib=document.querySelector('.library-container');
     return {dark:d.classList.contains('dark'),boot:d.getAttribute('data-boot'),
             lib:lib?getComputedStyle(lib).visibility:'absent'};
   }""")
   self.assertEqual(first['dark'],dark,f'{label}: theme wrong on the first paint')
   self.assertEqual(first['boot'],'problem',f'{label}: boot marker missing')
   self.assertEqual(first['lib'],'hidden',f'{label}: the library was visible on the first paint')
   self.page.wait_for_selector('.python-editor',timeout=15000);self.page.wait_for_timeout(300)
  self.page.evaluate("()=>localStorage.removeItem('interview-lab-theme')")
 def test_the_library_still_paints_immediately_on_its_own_url(self):
  # The hide is opt-in via the boot marker, so a plain load is unaffected.
  self.page.evaluate("()=>localStorage.removeItem('interview-lab-theme')")
  self.page.goto(URL+'/',wait_until='commit')
  first=self.page.evaluate("""() => {
    const d=document.documentElement;
    const lib=document.querySelector('.library-container');
    return {boot:d.getAttribute('data-boot'),lib:lib?getComputedStyle(lib).visibility:'absent'};
  }""")
  self.assertIsNone(first['boot'])
  self.assertEqual(first['lib'],'visible')
  self.page.wait_for_selector('.library-container',timeout=15000)
 def test_route_rejects_missing_key(self):
  r=self.context.request.post(URL+'/api/coach',data={'mode':'review','context':'test','messages':[]});self.assertEqual(r.status,401)
if __name__=='__main__':unittest.main(verbosity=2)
