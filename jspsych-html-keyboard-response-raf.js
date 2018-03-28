/**
 * jspsych-html-keyboard-response
 * Josh de Leeuw
 *
 * plugin for displaying a stimulus and getting a keyboard response
 *
 * documentation: docs.jspsych.org
 *
 * edited by Becky Gilbert to use rAF for display duration
 *
 **/

jsPsych.plugins["html-keyboard-response-raf"] = (function() {

  var plugin = {};
  
  plugin.info = {
    name: "html-keyboard-response-raf",
    parameters: {
      stimulus: {
        type: jsPsych.plugins.parameterType.STRING, // INT, IMAGE, KEYCODE, STRING, FUNCTION, FLOAT
        pretty_name: 'Stimulus',
        default: undefined,
        description: 'The HTML string to be displayed.'
      },
      choices: {
        type: jsPsych.plugins.parameterType.KEYCODE,
        array: true,
        pretty_name: 'Choices',
        default: jsPsych.ALL_KEYS,
        description: 'The keys the subject is allowed to press to respond to the stimulus.'
      },
      prompt: {
        type: jsPsych.plugins.parameterType.STRING,
        pretty_name: 'Prompt',
        default: null,
        description: 'Any content here will be displayed below the stimulus.'
      },
      stimulus_duration: {
        type: jsPsych.plugins.parameterType.INT,
        pretty_name: 'Stimulus duration',
        default: null,
        description: 'Time in ms from start of trial to when the stimulus should be hidden.'
      },
      trial_duration: {
        type: jsPsych.plugins.parameterType.INT,
        pretty_name: 'Trial duration',
        default: null,
        description: 'How long to show trial before it ends.'
      },
      response_ends_trial: {
        type: jsPsych.plugins.parameterType.BOOL,
        pretty_name: 'Response ends trial',
        default: true,
        description: 'If true, trial will end when subject makes a response.'
      },
      est_frame_duration: {
        type: jsPsych.plugins.parameterType.FLOAT,
        pretty_name: 'Estimated frame duration',
        default: 16.67,
        description: 'Estimated duration between frames (in ms)'
      }
    }
  };

  plugin.trial = function(display_element, trial) {

    var new_html = '<div id="jspsych-html-keyboard-response-stimulus">'+trial.stimulus+'</div>';

    // add prompt if there is one
    if(trial.prompt !== null){
      new_html += trial.prompt;
    }

    var keyboardListener, raf_ref, start_time;
    var response = {
      rt: null,
      key: null,
    };
    var target_stim_duration = null;
    var stimulus_duration_log = null;
    var target_frame_count = null;
    var frame_count = null;
    var end_trial_after_hiding_stim = false;

    // unlike the plugins using 'setTimeout', here we need a single value for the target stim duration
    // get this from stimulus_duration or trial_duration
    if (!(trial.stimulus_duration && trial.stimulus_duration > 0) && !(trial.trial_duration && trial.trial_duration > 0)) {
      // show an error if there's no trial_duration or stimulus_duration specified, or if they are invalid
      // TO DO:
      // - extend plugin to handle the absence of a trial/stimulus duration
      console.error('The jspsych-html-keyboard-response-raf plugin requires a positive number for either trial_duration or stimulus_duration.');
      return;
    }
    if (trial.stimulus_duration > 0 && trial.trial_duration > 0) {
      // if both stimulus and trial durations are set/valid, then use the smaller value
      if (trial.stimulus_duration <= trial.trial_duration) {
        target_stim_duration = trial.stimulus_duration;
      } else {
        target_stim_duration = trial.trial_duration;
        // if trial duration is the smaller value, then endTrial should be called immediately after hideStim
        end_trial_after_hiding_stim = true;
      }
    } else if (trial.stimulus_duration > 0) {
      target_stim_duration = trial.stimulus_duration;
    } else if (trial.trial_duration > 0) {
      target_stim_duration = trial.trial_duration;
      // if only a trial duration is set, then endTrial should be called immediately after hideStim
      end_trial_after_hiding_stim = true;
    } 
    console.log('target stim duration: ', target_stim_duration);

    // use a prefixed version of rAF if necessary
    // from https://msdn.microsoft.com/en-us/library/hh920765(v=vs.85).aspx
    // TO DO: 
    // - record in results which method was used (rAF or setTimeout)
    // - add fallback to Date.now timestamps for early implementations of rAF that pass a Date.now rather than performance.now timestamp?
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame =
      window.mozRequestAnimationFrame ||
      window.webkitRequestAnimationFrame ||
      window.oRequestAnimationFrame ||
      // if there's no support for rAF then fall back to set timeout at 60 fps
      function(callback) {
        return window.setTimeout(callback, 1000/60);
      };
    }

    // function to end trial 
    var end_trial = function() {

      // kill any remaining setTimeout handlers
      jsPsych.pluginAPI.clearAllTimeouts();

      // kill keyboard listeners
      if (typeof keyboardListener !== 'undefined') {
        jsPsych.pluginAPI.cancelKeyboardResponse(keyboardListener);
      }

      // gather the data to store for the trial
      var trial_data = {
        "rt": response.rt,
        "stimulus": trial.stimulus,
        "key_press": response.key,
        "est_frame_duration": trial.est_frame_duration,
        "target_stimulus_duration": target_stim_duration,
        "target_stimulus_duration_adj": target_stim_duration_adj,
        "stimulus_duration_log": stimulus_duration_log,
        "stimulus_duration_log_diff": target_stim_duration_adj - stimulus_duration_log,
        "target_frame_count": target_frame_count,
        "frame_count_log": frame_count
      };
      console.log('adjusted target duration : ', target_stim_duration_adj.toFixed(2)); 
      console.log('logged stimulus duration: ', stimulus_duration_log.toFixed(2));
      console.log('target - logged duration: ', trial_data.stimulus_duration_log_diff.toFixed(2));
      console.log('target frame count : ', target_frame_count);
      console.log('logged frame count : ', frame_count);

      // clear the display
      display_element.innerHTML = '';

      // move on to the next trial
      jsPsych.finishTrial(trial_data);
    };

    // function to handle responses by the subject
    var after_response = function(info) {  

      // after a valid response, the stimulus will have the CSS class 'responded'
      // which can be used to provide visual feedback that a response was recorded
      display_element.querySelector('#jspsych-html-keyboard-response-stimulus').className += ' responded';

      // only record the first response
      if (response.key === null) {
        response = info;
      }
      console.log('RT:', response.rt.toFixed(2));

      // if response_ends_trial is true, then end the trial (via the hideStim function) 
      if (trial.response_ends_trial) {
        end_trial_after_hiding_stim = true;
        hideStim();
      }
    };

    // function to hide the stimulus
    // this gets the stim offset timestamp, stops the rAF calls, and is always called before endTrial 
    function hideStim() {

      // if the stim has not been hidden yet
      if (stimulus_duration_log === null) {
        var stim_end_time = performance.now();
        // cancel any existing rAF calls
        if (typeof raf_ref !== 'undefined') {
          window.cancelAnimationFrame(raf_ref);
        }
        display_element.querySelector('#jspsych-html-keyboard-response-stimulus').style.visibility = 'hidden';
        stimulus_duration_log = stim_end_time - start_time;
      }
      
      // end the trial if necessary
      if (end_trial_after_hiding_stim) {
        end_trial();
      }
    }

    // function called from rAF to check whether or not the target duration has been reached
    function checkForTimeouts(timestamp, intended_delay, intended_frame_count, event_fn) {
      // compare current timestamp to that from the first stim onset to get the current time relative to stim onset
      var curr_delay = timestamp - start_time; 
      // if the current delay has reached the target delay, or if we've reached the target frame count, then call the event function
      //console.log("curr delay: ", curr_delay);
      //console.log("curr frame count: ", frame_count);
      if (curr_delay >= intended_delay || intended_frame_count == frame_count) {
        event_fn();
      } else {
        // not enough time has elapsed, so call rAF with this function as the callback again
        raf_ref = window.requestAnimationFrame(function(timestamp) {
          frame_count++;
          checkForTimeouts(timestamp, intended_delay, intended_frame_count, event_fn);});
      }
    }

    // 1st rAF call: draw stimulus, get start timestamp, and set up keyboard listener
    // use requestAnimationFrame function for everything so that the logged stim onset time is as close as possible to the real stim onset time
    window.requestAnimationFrame(function(timestamp) {
      display_element.innerHTML = new_html;
      start_time = performance.now();
      // keyboard listener logs a start time and uses that to get the RT (I think?), so it needs to be synchronised to the display onset 
      if (trial.choices != jsPsych.NO_KEYS) {
        keyboardListener = jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: after_response,
          valid_responses: trial.choices,
          rt_method: 'performance',
          persist: false,
          allow_held_key: false
        });
      }
      // if the trial should continue after the stim is hidden, then we need a setTimeout timer to end the trial
      if ((trial.trial_duration > 0) && !(end_trial_after_hiding_stim)) {
        jsPsych.pluginAPI.setTimeout(function() {
          // this can sometimes fire before the hideStim function via rAF (due to adjusting the target stim duration)
          // so we need to check whether the stimulus has been hidden already
          if (display_element.querySelector('#jspsych-html-keyboard-response-stimulus') && display_element.querySelector('#jspsych-html-keyboard-response-stimulus').style.visibility !== 'hidden') {
            // hideStim function has not called via rAF yet, so don't end the trial. Wait for hideStim to be called, and then end the trial immediately
            end_trial_after_hiding_stim = true;
          } else {
            // hideStim function has been called, so end the trial
            end_trial();
          }
        }, trial.trial_duration);
      }
      // if the target duration is valid, continue calling rAF and checking against this duration
      if (target_stim_duration) {
        // adjust the target stim duration so that it is the closest multiple of the frame duration
        var lower_dur = Math.floor(target_stim_duration/trial.est_frame_duration) * trial.est_frame_duration;
        var upper_dur = Math.ceil(target_stim_duration/trial.est_frame_duration) * trial.est_frame_duration;
        if ((target_stim_duration - lower_dur) <= (trial.est_frame_duration/2)) {
          target_stim_duration_adj = lower_dur;
        } else {
          target_stim_duration_adj = upper_dur;
        }
        target_frame_count = target_stim_duration_adj/trial.est_frame_duration;
        // 2nd rAF call: start frame count at 1 and call the checkForTimeouts function
        // checkForTimeouts will continue calling rAF until the target duration or frame count is reached
        raf_ref = window.requestAnimationFrame(function(timestamp) {
          frame_count=1;
          // subtract 2 ms from the adjusted target stim duration to account for rounding errors
          checkForTimeouts(timestamp, target_stim_duration_adj - 2, target_frame_count, hideStim);
        });
      }
    });

  };

  return plugin;
})();
