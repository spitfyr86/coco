$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Speech
  if ($env:COCO_VOICE_MODE -eq 'probe') {
    $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name })
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voices = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
    @{ recognizers = $recognizers; voices = $voices } | ConvertTo-Json -Compress
    $synth.Dispose()
  } elseif ($env:COCO_VOICE_MODE -eq 'speak') {
    $text = [Console]::ReadLine()
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SetOutputToDefaultAudioDevice()
    $synth.Speak($text)
    $synth.Dispose()
  } elseif ($env:COCO_VOICE_MODE -eq 'audio') {
    $bytes = [Convert]::FromBase64String([Console]::ReadLine())
    $stream = New-Object System.IO.MemoryStream(,$bytes)
    $player = New-Object System.Media.SoundPlayer($stream)
    try { $player.Load(); $player.PlaySync() } finally { $player.Dispose(); $stream.Dispose() }
  } else {
    Add-Type -ReferencedAssemblies System.Speech,System.Web.Extensions -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Recognition;
using System.Threading;
using System.Web.Script.Serialization;
public static class CoCoVoice {
  static readonly object Gate = new object();
  static readonly List<string> Words = new List<string>();
  public static void SelfTest() {
    const string phrase = "check the code";
    using (var audio = new System.IO.MemoryStream())
    using (var synth = new System.Speech.Synthesis.SpeechSynthesizer()) {
      var info = SpeechRecognitionEngine.InstalledRecognizers()[0];
      synth.SetOutputToWaveStream(audio);
      synth.Speak(phrase);
      audio.Position = 0;
      using (var engine = new SpeechRecognitionEngine(info)) {
        var grammar = new GrammarBuilder(); grammar.Culture = info.Culture; grammar.Append(phrase);
        engine.LoadGrammar(new Grammar(grammar)); engine.SetInputToWaveStream(audio);
        var result = engine.Recognize(TimeSpan.FromSeconds(8));
        if (result == null || !string.Equals(result.Text, phrase, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Synthetic speech loopback failed.");
        Emit("result", result.Text);
      }
    }
  }
  static void Emit(string kind, string text) {
    lock (Gate) { Console.WriteLine(new JavaScriptSerializer().Serialize(new { kind = kind, text = text })); Console.Out.Flush(); }
  }
  public static void Listen() {
    if (SpeechRecognitionEngine.InstalledRecognizers().Count == 0) throw new InvalidOperationException("Install a Windows speech recognition language pack first.");
    using (var engine = new SpeechRecognitionEngine(SpeechRecognitionEngine.InstalledRecognizers()[0]))
    using (var complete = new ManualResetEvent(false)) {
      engine.LoadGrammar(new DictationGrammar());
      engine.SetInputToDefaultAudioDevice();
      engine.SpeechRecognized += (s,e) => {
        if (e.Result.Confidence < 0.30) return;
        lock (Gate) { Words.Add(e.Result.Text); }
        Emit("partial", e.Result.Text);
      };
      engine.RecognizeCompleted += (s,e) => complete.Set();
      engine.RecognizeAsync(RecognizeMode.Multiple);
      Emit("ready", "");
      // ReadLine returns when Rust requests a stop or the parent closes stdin.
      var stop = System.Threading.Tasks.Task.Factory.StartNew(() => Console.ReadLine());
      stop.Wait(TimeSpan.FromSeconds(90));
      engine.RecognizeAsyncStop();
      complete.WaitOne(2500);
      string result; lock (Gate) { result = string.Join(" ", Words); }
      Emit("result", result);
    }
  }
}
'@
    if ($env:COCO_VOICE_MODE -eq 'selftest') { [CoCoVoice]::SelfTest() } else { [CoCoVoice]::Listen() }
  }
} catch {
  @{ kind = 'error'; text = 'Windows speech could not start. Check the microphone, desktop microphone permissions, and installed speech language.' } | ConvertTo-Json -Compress
  exit 1
}
