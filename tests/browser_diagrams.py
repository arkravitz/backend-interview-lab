"""Reference whiteboards, exercised through the real markdown renderer."""
import json, os, unittest
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get('LAB_URL', 'http://localhost:3000')
SCENARIOS = json.loads((ROOT / 'app/data/design.json').read_text())

class WhiteboardTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.pw = sync_playwright().start()
  cls.browser = cls.pw.chromium.launch(headless=True, channel=os.environ.get('LAB_BROWSER_CHANNEL') or None)
 @classmethod
 def tearDownClass(cls):
  cls.browser.close(); cls.pw.stop()
 def setUp(self):
  self.context = self.browser.new_context(viewport={'width':1440,'height':1000})
  self.page = self.context.new_page(); self.errors = []
  self.page.on('pageerror', lambda e:self.errors.append(str(e)))
 def tearDown(self):
  self.context.close(); self.assertEqual(self.errors, [])
 def open_solution(self, scenario):
  self.page.goto(URL+'?view=problem&track=design&id='+scenario['id'])
  self.page.get_by_role('tab', name='Solution', exact=True).click()
 def test_whiteboard_controls_and_mock_visibility(self):
  self.open_solution(SCENARIOS[1])
  board = self.page.locator('.design-whiteboard')
  expect(board.get_by_role('img', name='Architecture whiteboard')).to_be_visible(timeout=30000)
  self.assertTrue(board.get_by_role('img').evaluate('(img) => img.complete && img.naturalWidth > 0'))
  self.assertGreaterEqual(board.get_by_role('img').evaluate('(img) => img.width / img.naturalWidth'), 0.7, 'Whiteboard labels must remain readable in a narrow pane')
  board.get_by_role('button',name='Zoom in').click()
  expect(board.get_by_role('button',name='Reset zoom')).to_have_text('125%')
  board.get_by_text('Diagram source',exact=True).click()
  expect(board.locator('pre')).to_contain_text('flowchart')
  self.page.get_by_role('checkbox',name='Mock mode',exact=True).check()
  expect(self.page.locator('.design-whiteboard')).to_have_count(0)
 def test_every_scenario_renders_a_real_whiteboard(self):
  for scenario in SCENARIOS:
   with self.subTest(scenario=scenario['id']):
    self.open_solution(scenario)
    image = self.page.get_by_role('img',name='Architecture whiteboard')
    expect(image).to_be_visible(timeout=30000)
    self.assertTrue(image.evaluate('(img) => img.complete && img.naturalWidth > 0'))
    expect(self.page.locator('.diagram-error')).to_have_count(0)
 def test_whiteboard_scrolls_inside_its_frame_on_a_dark_mobile_layout(self):
  self.page.set_viewport_size({'width':390,'height':844})
  self.page.add_init_script("localStorage.setItem('interview-lab-theme','dark')")
  self.open_solution(SCENARIOS[1])
  image=self.page.get_by_role('img',name='Architecture whiteboard')
  expect(image).to_be_visible(timeout=30000)
  expect(self.page.locator('html')).to_have_class('dark')
  canvas=self.page.locator('.whiteboard-canvas')
  self.assertLessEqual(canvas.bounding_box()['width'],390)
  self.assertEqual(canvas.evaluate('(el)=>getComputedStyle(el).overflowX'),'auto')
  self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),390)

if __name__ == '__main__': unittest.main()
