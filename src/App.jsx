import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Play, Pause, Users, Video, VideoOff, Mic, MicOff, 
  Send, Share2, Settings, Monitor, LogOut, Check
} from 'lucide-react';

// Connect to your local backend server
const SOCKET_URL = "http://localhost:3001";
const socket = io(SOCKET_URL, { autoConnect: false });

export default function App() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('User_' + Math.floor(Math.random() * 1000));
  const [inRoom, setInRoom] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  
  const videoRef = useRef(null);

  // --- Socket Event Listeners ---
  useEffect(() => {
    socket.on('user-joined', (user) => {
      setParticipants(prev => [...prev, { ...user, isCameraOn: false, isMicOn: false }]);
      addSystemMessage(`${user.name} joined the party.`);
    });

    socket.on('room-state', (state) => {
      const formattedParticipants = state.participants.map(p => ({
        ...p, isCameraOn: false, isMicOn: false
      }));
      setParticipants(formattedParticipants);
    });

    socket.on('sync-play', (data) => {
      if (videoRef.current) {
        // Sync time before playing to prevent rubber-banding
        if (Math.abs(videoRef.current.currentTime - data.currentTime) > 1) {
          videoRef.current.currentTime = data.currentTime;
        }
        videoRef.current.play();
        setIsPlaying(true);
      }
    });

    socket.on('sync-pause', () => {
      if (videoRef.current) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    });

    socket.on('sync-seek', (time) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
        setCurrentTime(time);
      }
    });

    socket.on('new-message', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    return () => {
      socket.off('user-joined');
      socket.off('room-state');
      socket.off('sync-play');
      socket.off('sync-pause');
      socket.off('sync-seek');
      socket.off('new-message');
    };
  }, []);

  // --- UI Handlers ---
  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId && username) {
      socket.connect();
      socket.emit('join-room', roomId, username);
      setInRoom(true);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(url);
    }
  };

  const copyRoomLink = () => {
    const link = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(err => {
      console.error('Failed to copy link: ', err);
    });
  };

  const addSystemMessage = (text) => {
    setMessages(prev => [...prev, { 
      sender: 'System', 
      text, 
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSystem: true 
    }]);
  };

  // --- Video Sync Logic ---
  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
      socket.emit('video-pause', { roomId });
    } else {
      videoRef.current.play();
      socket.emit('video-play', { roomId, currentTime: videoRef.current.currentTime });
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    socket.emit('video-seek', { roomId, currentTime: time });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    const msgData = { 
      roomId,
      sender: username, 
      text: chatInput, 
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    };
    
    socket.emit('send-message', msgData);
    setChatInput('');
  };

  const leaveRoom = () => {
    socket.disconnect();
    setInRoom(false);
    setVideoFile(null);
    setMessages([]);
    setParticipants([]);
  };

  if (!inRoom) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans text-slate-100">
        <div className="max-w-md w-full space-y-8 bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-2xl">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-xl mb-4">
              <Monitor size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Mywatchparty</h1>
            <p className="mt-2 text-slate-400">Sync movies, share moments.</p>
          </div>

          <form onSubmit={handleJoinRoom} className="mt-8 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Your Name</label>
              <input
                type="text"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Room ID</label>
              <input
                type="text"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="Enter room code..."
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-lg transition-colors shadow-lg shadow-blue-900/20"
            >
              Start Watching
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-black text-slate-100 overflow-hidden font-sans">
      {/* Main Player Area */}
      <div className="flex-1 flex flex-col relative group">
        <div className="flex-1 bg-black flex items-center justify-center relative">
          {videoFile ? (
            <video 
              ref={videoRef}
              src={videoFile}
              className="max-h-full w-full"
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
          ) : (
            <div className="text-center p-8">
              <label className="cursor-pointer inline-flex flex-col items-center">
                <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center hover:bg-slate-700 transition-colors mb-4">
                    <Video size={32} className="text-blue-500" />
                </div>
                <h2 className="text-xl font-medium text-slate-300 hover:text-white transition-colors">Select Local Video to Host</h2>
                <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
              </label>
              <p className="text-slate-600 mt-2 text-sm">Note: Only the host's video state is synced.</p>
            </div>
          )}

          {/* Video Controls Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="space-y-4">
              <input 
                type="range" 
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                min="0"
                max={videoRef.current?.duration || 100}
                value={currentTime}
                onChange={handleSeek}
              />
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <button onClick={togglePlay} className="hover:text-blue-400 transition-colors">
                    {isPlaying ? <Pause size={28} /> : <Play size={28} />}
                  </button>
                  <span className="text-sm font-mono">
                    {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} / 
                    {videoRef.current ? ` ${Math.floor(videoRef.current.duration / 60)}:${Math.floor(videoRef.current.duration % 60).toString().padStart(2, '0')}` : ' 00:00'}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <button onClick={copyRoomLink} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
                    {copySuccess ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
                    {copySuccess ? 'Copied!' : 'Invite Friends'}
                  </button>
                  <button onClick={leaveRoom} className="text-slate-400 hover:text-red-400 transition-colors">
                    <LogOut size={24} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Social Sidebar */}
      <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl">
        {/* Participants Grid */}
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Users size={18} className="text-blue-400" />
              Watchers ({participants.length})
            </h3>
            <Settings size={18} className="text-slate-500 cursor-pointer hover:text-white" />
          </div>
          
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scrollbar-hide">
            {participants.map((p, index) => (
              <div key={index} className="aspect-video bg-slate-800 rounded-lg relative overflow-hidden ring-1 ring-slate-700">
                <div className="absolute inset-0 flex items-center justify-center bg-slate-800/50">
                   {!p.isCameraOn && <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">{p.name[0]}</div>}
                </div>
                <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1">
                  <span className="text-[10px] truncate max-w-[50px] bg-black/50 px-1 rounded">{p.name}</span>
                  <div className="flex gap-1">
                    {p.isMicOn ? <Mic size={10} className="text-blue-400" /> : <MicOff size={10} className="text-slate-500" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            {messages.length === 0 && (
                <div className="text-center py-10 opacity-30">
                  <Send size={32} className="mx-auto mb-2" />
                  <p className="text-xs">No messages yet</p>
                </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${msg.isSystem ? 'text-slate-500' : 'text-blue-400'}`}>
                    {msg.sender}
                  </span>
                  <span className="text-[10px] text-slate-500">{msg.time}</span>
                </div>
                {!msg.isSystem && <p className="text-sm bg-slate-800 p-2 rounded-lg rounded-tl-none">{msg.text}</p>}
                {msg.isSystem && <p className="text-xs text-slate-500 italic">{msg.text}</p>}
              </div>
            ))}
          </div>

          <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900">
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Type a message..."
                className="flex-1 bg-slate-800 border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <button type="submit" className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg transition-colors">
                <Send size={18} />
              </button>
            </div>
            
            <div className="flex justify-center gap-6 mt-4 pt-2">
               <button type="button" className="text-slate-400 hover:text-blue-400 transition-colors">
                  <Video size={20} />
               </button>
               <button type="button" className="text-slate-400 hover:text-blue-400 transition-colors">
                  <Mic size={20} />
               </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}