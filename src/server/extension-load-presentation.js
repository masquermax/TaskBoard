function text(value){return String(value==null?'':value).trim();}

export function extensionLoadPresentation(value){
  const error=text(value);
  if(!error)return null;
  if(error.startsWith('EXTENSION_API_VERSION_UNSUPPORTED:'))return`版本不兼容 · ${error}`;
  if(error.startsWith('EXTENSION_EXECUTOR_INVALID:')||error.startsWith('EXTENSION_EXECUTOR_NOT_IMPLEMENTED:'))return`接口不兼容 · ${error}`;
  return`启动失败 · ${error}`;
}

export function presentExtensionLoadState(state={}){
  const loadedIds=Array.isArray(state?.loadedIds)?[...state.loadedIds]:[];
  const loadErrors={};
  for(const[id,error]of Object.entries(state?.loadErrors||{}))loadErrors[id]=extensionLoadPresentation(error);
  return{loadedIds,loadErrors};
}
