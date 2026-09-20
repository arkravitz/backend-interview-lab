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
