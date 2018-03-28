/**
 * jspsych-call-function-wait
 * plugin for calling an arbitrary function during a jspsych experiment
 *
 * based on jspsych-call-function plugin by Josh de Leeuw, but waits for function to finish executing before
 * ending the trial
 *
 * Becky Gilbert
 *
 **/

jsPsych.plugins['call-function-wait'] = (function() {

  var plugin = {};

  plugin.info = {
    name: 'call-function-wait',
    description: '',
    parameters: {
      func: {
        type: jsPsych.plugins.parameterType.FUNCTION,
        pretty_name: 'Function',
        default: undefined,
        description: 'Function to call'
      },
    }
  };

  plugin.trial = function(display_element, trial) {
    
    trial.post_trial_gap = 0;
    
    function endTrialCallback() {
      jsPsych.finishTrial();
    }

    trial.func(endTrialCallback);

  };

  return plugin;
})();
