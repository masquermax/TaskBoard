export function recordTaskDiagnostic(event,data={}){
  try{
    console.log(`[task-runtime] ${JSON.stringify({ts:new Date().toISOString(),event,...data})}`);
  }catch{}
}
