"use strict";

/* @flow */
import Mailbox from "./mailbox";
import ProcessManager from "./process_manager";
import States from "./states";

const NOMSG = Symbol();

class Process {
  pid: Number;
  mailbox: Mailbox;
  func: Function;
  args: Array;
  manager: ProcessManager;
  status: Symbol;

  constructor(pid: Number, func: Function, args: Array, mailbox: Mailbox, manager: ProcessManager){
    this.pid = pid;
    this.func = func;
    this.args = args;
    this.mailbox = mailbox;
    this.manager = manager;
    this.status = States.STOPPED;
  }

  start(){
    let machine = this.main();
    let step = machine.next();

    this.status = States.RUNNING;
    
    this.run(machine, step);
  }

  *main() {
    let retval = States.NORMAL;

    try {
      for(let v of this.func.apply(null, this.args)){
        yield v;
      }
    } catch(e) {
      retval = e;
    }

    this.manager.exit(this.pid, retval);
  }

  exit(reason){
    this.manager.remove_proc(this.pid, reason);
  }

  receive(fun){
    let value = NOMSG;
    let messages = this.mailbox.get();

    for(let i = 0; i < messages.length; i++){
      try{
        value = fun(messages[i]);
        this.mailbox.removeAt(i);
      }catch(e){
        if(!e instanceof MatchError){
          this.exit(e);
        }
      }
    }

    return value;
  }

  run(machine, step){
    const function_scope = this;
    this.manager.set_current(this);

    if(!step.done){
      let value = step.value;

      if(typeof value === 'symbol'){
        switch(value){
          case SUSPEND:
            this.manager.suspend(function() { 
              function_scope.run(machine, step); 
            });
            return;
          default:
            this.manager.queue(function() { 
              function_scope.run(machine, machine.next()); 
            });
            return;
        }      
      }else if(Array.isArray(value) && value[0] === States.SLEEP){

        this.manager.delay(function() { 
          function_scope.run(machine, machine.next()); 
        }, value[1]);

      }else if(Array.isArray(value) && value[0] === States.RECEIVE){
        if(value[2] != null && value[2] < Date.now()){
          let result = value[3]();

          this.manager.queue(function() { 
            function_scope.run(machine, machine.next(result)); 
          });
        }else{
          let result = function_scope.receive(value[1]);

          if(result === NOMSG){
            this.manager.suspend(function() { 
              function_scope.run(machine, step); 
            });         
          }else{
            this.manager.queue(function() { 
              function_scope.run(machine, machine.next(result)); 
            });          
          }
        }

      }else{
        this.manager.queue(function() { 
          function_scope.run(machine, machine.next()); 
        });        
      }
    }
  }
}

export default Process;