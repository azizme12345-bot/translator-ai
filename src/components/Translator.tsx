import React, { useState, useEffect, useRef } from 'react';
import { ArrowRightLeft, Mic, MicOff, Volume2, Copy, Trash2, Loader2, Square, Info, History, Clock } from 'lucide-react';
import { LANGUAGES, TARGET_LANGUAGES } from '../constants';
import { translateClientSide } from '../utils/clientTranslator';
import { TranslationHistoryItem } from '../types';
import { saveTranslationToHistory, getTranslationHistory } from '../utils/historyStorage';

// Declare types for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface TranslatorProps {
  initialItem?: TranslationHistoryItem | null;
  onOpenHistory?: () => void;
}

const getLanguageCode = (languageName: string): string => {
  const map: Record<string, string> = {
    "English": "en-US",
    "Urdu": "ur-PK",
    "Punjabi": "pa-PK",
    "Japanese": "ja-JP",
    "Hindi": "hi-IN",
    "Arabic": "ar-SA",
    "French": "fr-FR",
    "German": "de-DE",
    "Spanish": "es-ES",
    "Chinese": "zh-CN",
    "Korean": "ko-KR",
    "Italian": "it-IT",
    "Portuguese": "pt-BR",
    "Russian": "ru-RU",
    "Turkish": "tr-TR",
    "Persian": "fa-IR",
    "Bengali": "bn-BD",
    "Indonesian": "id-ID",
    "Malay": "ms-MY"
  };
  return map[languageName] || "en-US";
};

export default function Translator({ initialItem, onOpenHistory }: TranslatorProps = {}) {
  const [sourceLanguage, setSourceLanguage] = useState<string>("Auto Detect");
  const [targetLanguage, setTargetLanguage] = useState<string>("English");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentHistory, setRecentHistory] = useState<TranslationHistoryItem[]>([]);
  
  // Speech Recognition State
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");
  const isStoppingRef = useRef<boolean>(false);

  // Speech Synthesis State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load history from localStorage
  const refreshHistory = () => {
    setRecentHistory(getTranslationHistory());
  };

  useEffect(() => {
    refreshHistory();
    const onHistChange = () => refreshHistory();
    window.addEventListener('translation-history-changed', onHistChange);
    return () => {
      window.removeEventListener('translation-history-changed', onHistChange);
    };
  }, []);

  // When an item is passed from the History page, load it
  useEffect(() => {
    if (initialItem) {
      setInputText(initialItem.sourceText);
      setOutputText(initialItem.translatedText);
      setSourceLanguage(initialItem.sourceLanguage);
      setTargetLanguage(initialItem.targetLanguage);
      setError(null);
    }
  }, [initialItem]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      // Pre-load available voices
      window.speechSynthesis.getVoices();
      const onVoicesChanged = () => {
        if (synthRef.current) {
          synthRef.current.getVoices();
        }
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
    }

    return () => {
      cleanupRecognition();
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  const cleanupRecognition = () => {
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      // Detach all listeners first to prevent spurious callbacks
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch (e) {
        try {
          rec.abort();
        } catch (e2) {}
      }
    }
  };

  const handleSwapLanguages = () => {
    if (isListening) {
      stopListening();
    }
    if (sourceLanguage === "Auto Detect") {
      setSourceLanguage(targetLanguage);
      setTargetLanguage("English"); // Default fallback
    } else {
      setSourceLanguage(targetLanguage);
      setTargetLanguage(sourceLanguage);
    }
    
    // Swap text
    const oldInput = inputText;
    setInputText(outputText);
    setOutputText(oldInput);
  };

  const stopListening = () => {
    isStoppingRef.current = true;
    setIsListening(false);
    cleanupRecognition();
  };

  const startListening = async () => {
    setError(null);
    isStoppingRef.current = false;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition is blocked in embedded iframe previews or unsupported in this browser. Please open the app in a new tab (or use Google Chrome / Edge) and allow microphone permissions.");
      return;
    }

    // Clean up any existing instance cleanly
    cleanupRecognition();

    // Check & request microphone permission if supported
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately release tracks so SpeechRecognition has free access to the hardware
        stream.getTracks().forEach((track) => track.stop());
      } catch (permErr: any) {
        if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
          setError("Microphone permission was denied. Please allow microphone access in your browser settings or URL bar.");
          return;
        }
      }
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      // Select proper language code based on user selection
      // Urdu: ur-PK, English: en-US, Punjabi: pa-PK, Japanese: ja-JP
      let langCode = "ur-PK";
      if (sourceLanguage !== "Auto Detect") {
        langCode = getLanguageCode(sourceLanguage);
      } else {
        // In Auto Detect mode: if target is Urdu, user speaks English; otherwise Urdu
        langCode = targetLanguage === "Urdu" ? "en-US" : "ur-PK";
      }
      recognition.lang = langCode;

      baseTextRef.current = inputText;

      recognition.onstart = () => {
        isStoppingRef.current = false;
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = 0; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalTranscript += res[0].transcript;
          } else {
            interimTranscript += res[0].transcript;
          }
        }

        const recognized = (finalTranscript + (interimTranscript ? ' ' + interimTranscript : '')).trim();
        const base = baseTextRef.current.trim();
        const combined = base ? (recognized ? `${base} ${recognized}` : base) : recognized;
        setInputText(combined);
      };

      recognition.onerror = (event: any) => {
        const err = event.error;
        // Never treat 'aborted', 'no-speech', or intentional stopping as an error
        if (err === 'aborted' || err === 'no-speech' || isStoppingRef.current) {
          setIsListening(false);
          return;
        }

        console.warn("Speech recognition notice:", err);
        setIsListening(false);

        if (err === 'not-allowed' || err === 'service-not-allowed') {
          setError("Microphone permission was denied. Please allow microphone access in your browser settings.");
        } else if (err === 'network') {
          setError("Speech recognition network error. Please check your internet connection.");
        } else if (err === 'audio-capture') {
          setError("No microphone was detected on your device.");
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
        isStoppingRef.current = false;
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err: any) {
      setIsListening(false);
      if (err.name !== 'InvalidStateError') {
        console.warn("Could not start speech recognition:", err);
        setError("Could not start microphone. Please try again.");
      }
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleTranslate = async () => {
    if (!inputText.trim()) return;

    if (isListening) {
      stopListening();
    }
    if (isSpeaking && synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
      activeUtteranceRef.current = null;
    }

    setIsTranslating(true);
    setError(null);
    setOutputText("");
    
    try {
      let translationResult = "";
      let translated = false;

      // 1. Try server-side proxy endpoint first (available in AI Studio / Node environment)
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: inputText,
            sourceLanguage,
            targetLanguage
          })
        });

        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = await response.json();
          if (data && data.translation) {
            translationResult = data.translation;
            translated = true;
          }
        }
      } catch (serverErr) {
        console.warn("Server API not reachable (running on static host like GitHub Pages). Using client-side translator.", serverErr);
      }

      // 2. If server API not available (e.g. deployed to static GitHub Pages), translate client-side
      if (!translated) {
        translationResult = await translateClientSide(inputText, sourceLanguage, targetLanguage);
      }

      setOutputText(translationResult);
      if (translationResult && translationResult.trim()) {
        saveTranslationToHistory(inputText, translationResult, sourceLanguage, targetLanguage);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during translation');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      // Could add a small toast notification here, but keeping it simple as requested
      const copyBtn = document.getElementById('copy-btn');
      if (copyBtn) {
        const originalText = copyBtn.innerText;
        copyBtn.innerText = "Copied!";
        setTimeout(() => {
          if (copyBtn) copyBtn.innerText = originalText;
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const toggleSpeak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setError("Text-to-Speech is not supported in this browser.");
      return;
    }

    const synth = window.speechSynthesis;
    synthRef.current = synth;

    if (isSpeaking) {
      synth.cancel();
      setIsSpeaking(false);
      activeUtteranceRef.current = null;
      return;
    }

    if (!outputText || !outputText.trim()) return;

    if (isListening) {
      stopListening();
    }

    // Clear any previous queued utterance in browser
    synth.cancel();

    try {
      const langCode = getLanguageCode(targetLanguage);
      const utterance = new SpeechSynthesisUtterance(outputText);
      utterance.lang = langCode;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select matching voice for the target language if available in browser
      const voices = synth.getVoices();
      if (voices && voices.length > 0) {
        const langPrefix = langCode.split('-')[0].toLowerCase();
        const matchedVoice =
          voices.find(v => v.lang.replace('_', '-').toLowerCase() === langCode.toLowerCase()) ||
          voices.find(v => v.lang.replace('_', '-').toLowerCase().startsWith(langPrefix));
        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        setError(null);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        activeUtteranceRef.current = null;
      };

      utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          console.warn("Speech synthesis error:", e);
        }
        setIsSpeaking(false);
        activeUtteranceRef.current = null;
      };

      // Keep reference to prevent garbage collection mid-speech in Chrome/Blink
      activeUtteranceRef.current = utterance;
      synth.speak(utterance);
    } catch (err: any) {
      console.warn("Failed to speak translation:", err);
      setIsSpeaking(false);
      activeUtteranceRef.current = null;
    }
  };

  const handleClear = () => {
    setInputText("");
    setOutputText("");
    setError(null);
    baseTextRef.current = "";
    if (isListening) {
      stopListening();
    }
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
    activeUtteranceRef.current = null;
  };

  const handleSelectRecent = (item: TranslationHistoryItem) => {
    setInputText(item.sourceText);
    setOutputText(item.translatedText);
    setSourceLanguage(item.sourceLanguage);
    setTargetLanguage(item.targetLanguage);
    setError(null);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 md:p-8 font-sans">
      <header className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 tracking-tight">AI Translator</h1>
          <p className="text-gray-500 mt-1">Translate text and voice instantly</p>
        </div>
        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 hover:text-blue-600 rounded-xl shadow-sm transition-all text-sm font-medium"
            title="Open Translation History Page"
          >
            <History className="w-4 h-4 text-blue-600" />
            <span>History</span>
            {recentHistory.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">
                {recentHistory.length}
              </span>
            )}
          </button>
        )}
      </header>

      {/* Quick Recent Translations Bar */}
      {recentHistory.length > 0 && (
        <div className="mb-6 bg-white p-3 sm:p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-600">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>Recent Translations (Click to re-select):</span>
            </div>
            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-semibold"
              >
                View full history page →
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {recentHistory.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelectRecent(item)}
                className="group flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-50 hover:bg-blue-50 hover:border-blue-300 border border-gray-200 text-gray-700 hover:text-blue-700 transition-all text-left"
                title={`${item.sourceLanguage} → ${item.targetLanguage}: "${item.sourceText}"`}
              >
                <span className="font-bold text-gray-400 group-hover:text-blue-500">
                  {item.sourceLanguage.slice(0, 2).toUpperCase()}→{item.targetLanguage.slice(0, 2).toUpperCase()}:
                </span>
                <span className="truncate max-w-[120px] sm:max-w-[180px]">
                  {item.sourceText}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Language Selectors */}
      <div className="flex flex-col sm:flex-row items-center justify-between bg-white p-2 rounded-xl shadow-sm border border-gray-100 mb-6 gap-3 sm:gap-0">
        <select 
          value={sourceLanguage}
          onChange={(e) => setSourceLanguage(e.target.value)}
          className="w-full sm:w-[45%] bg-transparent p-3 text-lg font-medium text-gray-700 outline-none cursor-pointer appearance-none text-center sm:text-left border sm:border-none rounded-lg border-gray-200"
          aria-label="Source Language"
        >
          {LANGUAGES.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>

        <button 
          onClick={handleSwapLanguages}
          className="p-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          aria-label="Swap Languages"
          title="Swap Languages"
        >
          <ArrowRightLeft className="w-5 h-5" />
        </button>

        <select 
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
          className="w-full sm:w-[45%] bg-transparent p-3 text-lg font-medium text-gray-700 outline-none cursor-pointer appearance-none text-center sm:text-right border sm:border-none rounded-lg border-gray-200"
          aria-label="Target Language"
        >
          {TARGET_LANGUAGES.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
      </div>

      {/* Info Banner for Voice/Audio */}
      <div className="mb-6 p-4 bg-blue-50 text-blue-800 rounded-xl border border-blue-100 text-xs sm:text-sm flex items-start space-x-3">
        <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold block mb-0.5">Voice & Audio Note:</span>
          Browser security policies in embedded preview iframes may restrict microphone access. If speech recognition or speaker output does not start, please open the app in a <strong>New Tab</strong> (using the share/open menu) and allow microphone permissions.
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg border border-red-100 text-sm">
          {error}
        </div>
      )}

      {/* Input / Output Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        {/* Source Text Area */}
        <div className="flex flex-col bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleTranslate();
              }
            }}
            dir="auto"
            placeholder="Type or speak to translate..."
            className="w-full h-48 lg:h-64 p-5 text-lg text-gray-800 resize-none outline-none placeholder-gray-400 bg-transparent"
            aria-label="Source text"
          />
          <div className="flex items-center justify-between p-3 bg-gray-50/50 border-t border-gray-100">
            <button
              onClick={toggleListening}
              className={`px-3.5 py-2.5 rounded-full flex items-center justify-center transition-all duration-200 ${
                isListening 
                  ? 'bg-red-500 text-white shadow-md shadow-red-200 animate-pulse ring-4 ring-red-100' 
                  : 'bg-white text-gray-700 hover:bg-gray-100 shadow-sm border border-gray-200'
              }`}
              aria-label={isListening ? "Stop listening" : "Start voice input"}
              title={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-gray-600" />}
              {isListening ? (
                <span className="ml-2 text-sm font-semibold tracking-wide flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping inline-block" />
                  Listening...
                </span>
              ) : (
                <span className="ml-1.5 text-xs text-gray-500 font-medium hidden sm:inline">Voice</span>
              )}
            </button>
            <button
              onClick={handleClear}
              disabled={!inputText && !outputText}
              className="p-3 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Clear text"
              title="Clear"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Target Text Area */}
        <div className="flex flex-col bg-gray-50 border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="w-full h-48 lg:h-64 p-5 text-lg text-gray-800 overflow-y-auto">
             {isTranslating ? (
                <div className="flex items-center space-x-3 text-blue-600 h-full">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="font-medium animate-pulse">Translating...</span>
                </div>
             ) : (
                outputText ? (
                  <p 
                    dir={["Urdu", "Arabic", "Persian"].includes(targetLanguage) ? "rtl" : "ltr"}
                    className="whitespace-pre-wrap leading-relaxed"
                  >
                    {outputText}
                  </p>
                ) : (
                  <p className="text-gray-400 italic">Translation will appear here...</p>
                )
             )}
          </div>
          <div className="flex items-center justify-end p-3 bg-gray-100/50 border-t border-gray-200 space-x-2">
            <button
              id="speak-btn"
              onClick={toggleSpeak}
              disabled={!outputText}
              className={`p-3 rounded-full flex items-center justify-center transition-all duration-200 ${
                isSpeaking 
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200 animate-pulse ring-4 ring-blue-100' 
                  : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 shadow-sm border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
              }`}
              aria-label={isSpeaking ? "Stop speaking" : "Read translation aloud"}
              title={isSpeaking ? "Stop speaking" : "Read translation aloud"}
            >
              {isSpeaking ? (
                <Square className="w-5 h-5 fill-current" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
              {isSpeaking && (
                <span className="ml-1.5 text-xs font-semibold pr-1 hidden sm:inline">Speaking...</span>
              )}
            </button>
            <button
              id="copy-btn"
              onClick={handleCopy}
              disabled={!outputText}
              className="px-4 py-3 bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-gray-200 rounded-full shadow-sm transition-colors flex items-center space-x-2 font-medium text-sm disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
              aria-label="Copy translation"
            >
              <Copy className="w-4 h-4" />
              <span className="hidden sm:inline">Copy</span>
            </button>
          </div>
        </div>

      </div>

      {/* Translate Button Container */}
      <div className="flex justify-center mt-8">
        <button
          onClick={handleTranslate}
          disabled={!inputText.trim() || isTranslating}
          className="w-full sm:w-auto px-10 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-70 disabled:active:scale-100 disabled:shadow-none flex items-center justify-center space-x-3 text-lg"
        >
          {isTranslating ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Translating...</span>
            </>
          ) : (
            <span>Translate</span>
          )}
        </button>
      </div>

    </div>
  );
}
