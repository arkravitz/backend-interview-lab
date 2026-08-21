/* Each worker owns one interpreter. Terminating it stops Python immediately. */
let runtime;
const ready = (async () => {
  importScripts('/python/pyodide.js');
  runtime = await loadPyodide({indexURL:'/python/'});
  runtime.setStdin({stdin:()=>undefined});
  const response = await fetch('/runner.py');
  if (!response.ok) throw new Error('Could not load Python test runner.');
  runtime.runPython(await response.text());
})();
self.onmessage = async ({data}) => {
  try {
    await ready;
    self.postMessage({type:'started'});
    runtime.globals.set('_submission_json', JSON.stringify(data));
    const result = await runtime.runPythonAsync('await run_submission(_submission_json)');
    self.postMessage({type:'result',...JSON.parse(result)});
  } catch(error) {
    self.postMessage({type:'result',error:String(error),results:[],output:''});
  }
};
ready.catch(error=>self.postMessage({type:'result',error:'Python could not load. Reload and try again. '+String(error),results:[],output:''}));
