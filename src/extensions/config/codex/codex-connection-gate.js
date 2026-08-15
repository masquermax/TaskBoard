function capacityError(message='Codex connection is being reconfigured') {
  const error=new Error(message);
  error.capacityUnavailable=true;
  return error;
}

export class CodexConnectionGate {
  constructor(){this.reconfiguring=false;this.activeRuns=0;}

  async run(operation){
    if(this.reconfiguring)throw capacityError();
    this.activeRuns+=1;
    try{return await operation();}
    finally{this.activeRuns=Math.max(0,this.activeRuns-1);}
  }

  beginReconfigure(){
    if(this.reconfiguring||this.activeRuns>0)throw new Error('EXECUTOR_CONNECTION_BUSY');
    this.reconfiguring=true;
    return()=>{this.reconfiguring=false;};
  }

  snapshot(){return{reconfiguring:this.reconfiguring,activeRuns:this.activeRuns};}
}
