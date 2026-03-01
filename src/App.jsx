import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Peer from 'simple-peer';
import { 
  Play, Pause, Users, Video, VideoOff, Mic, MicOff, 
  Send, Share2, Settings, Monitor, LogOut, Check
} from 'lucide-react';

// IMPORTANT: Replace this with your actual Render URL before deploying to Vercel!
const SOCKET_URL = "https://mywatchparty-backend-xyz.onrender.com"; 
const socket = io(SOCKET_URL, { autoConnect: false });

export default function App() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('User_' + Math.floor(Math.random() * 1000));
  const [inRoom, setInRoom] = useState(false);
  
  // Video Sync State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoFile, setVideoFile] = useState(null);
  
  // Chat & UI State
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [roomParticipants, setRoomParticipants] = useState([]); 
  
  // WebRTC State
  const [peers, setPeers] = useState([]); 
  const [localStream, setLocalStream] = useState(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);

  const videoRef = useRef(null);
  const userVideoRef = useRef(null);
  const peersRef = useRef([]);

  // --- 1. CORE SOCKET EVENT LISTENERS ---
  useEffect(() => {
    socket.on('user-joined', (user) => {
      setRoomParticipants(prev => [...prev, user]);
      addSystemMessage(`${user.name} joined the party.`);
    });

    socket.on('room-state', (state) => {
      setRoomParticipants(state.participants);
    });

    socket.on('user-disconnected', (userId) => {
      setRoomParticipants(prev => prev.filter(p => p.id !== userId));
      
      const peerObj = peersRef.current.find(p => p.peerID === userId);
      if (peerObj) peerObj.peer.destroy();
      
      const peersData = peersRef.current.filter(p => p.peerID !== userId);
      peersRef.current = peersData;
      setPeers(peersData);
    });

    socket.on('sync-play', (data) => {
      if (videoRef.current) {
        if (Math.abs(videoRef.current.currentTime - data.currentTime) > 1) {
          videoRef.current.currentTime = data.currentTime;
        }
        videoRef.current.play().catch(e => console.log("Play prevented:", e));
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
      socket.off('user-disconnected');
      socket.off('sync-play');
      socket.off('sync-pause');
      socket.off('sync-seek');
      socket.off('new-message');
    };
  }, []);

  // --- 2. WEBRTC SIGNALING LISTENERS ---
  useEffect(() => {
    socket.on('user-joined-rtc', payload => {
      if (localStream) {
        const peer = addPeer(payload.signal, payload.callerID, localStream);
        const newPeerObj = {
          peerID: payload.callerID,
          peer,
          username: payload.username
        };
        peersRef.current.push(newPeerObj);
        setPeers([...peersRef.current]);
      }
    });

    socket.on('receiving-returned-signal', payload => {
      const item = peersRef.current.find(p => p.peerID === payload.id);
      if (item) {
        item.peer.signal(payload.signal);
      }
    });

    return () => {
      socket.off('user-joined-rtc');
      socket.off('receiving-returned-signal');
    };
  }, [localStream]);

  // --- 3. MEDIA CAPTURE & PEER CREATION ---
  const toggleMedia = async (type) => {
    try {
      if (!localStream) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        stream.getVideoTracks()[0].enabled = type === 'video';
        stream.getAudioTracks()[0].enabled = type === 'audio';
        
        setLocalStream(stream);
        setIsCameraOn(type === 'video');
        setIsMicOn(type === 'audio');
        
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = stream;
        }

        const peers = [];
        roomParticipants.forEach(user => {
          if (user.id !== socket.id) {
            const peer = createPeer(user.id, socket.id, stream);
            peersRef.current.push({ peerID: user.id, peer, username: user.name });
            peers.push({ peerID: user.id, peer, username: user.name });
          }
        });
        setPeers(peers);

      } else {
        if (type === 'video') {
          localStream.getVideoTracks()[0].enabled = !isCameraOn;
          setIsCameraOn(!isCameraOn);
        } else if (type === 'audio') {
          localStream.getAudioTracks()[0].enabled = !isMicOn;
          setIsMicOn(!isMicOn);
        }
      }
    } catch (err) {
      console.error("Failed to get local media", err);
      addSystemMessage("Could not access camera or microphone. Please check permissions.");
    }
  };

  const createPeer = (userToSignal, callerID, stream) => {
    const peer = new Peer({ initiator: true, trickle: false, stream });
    peer.on('signal', signal => {
      socket.emit('sending-signal', { userToSignal, callerID, signal, username });
    });
    return peer;
  };

  const addPeer = (incomingSignal, callerID, stream) => {
    const peer = new Peer({ initiator: false, trickle: false, stream });
    peer.on('signal', signal => {
      socket.emit('returning-signal', { signal, callerID });
    });
    peer.signal(incomingSignal);
    return peer;
  };

  // --- 4. UI HANDLERS (JOIN & HOST) ---
  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId && username.trim()) {
      socket.connect();
      socket.emit('join-room', roomId, username);
      setInRoom(true);
    }
  };

  const handleHostNewRoom = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!username.trim()) {
        alert("Please enter your name first!");
        return;
      }
      // Generate a random 6-character room ID
      const generatedRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const url = URL.createObjectURL(file);
      
      setVideoFile(url);
      setRoomId(generatedRoomId);
      
      socket.connect();
      socket.emit('join-room', generatedRoomId, username);
      setInRoom(true);
    }
  };

  const copyRoomLink = () => {
    const link = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const addSystemMessage = (text) => {
    setMessages(prev => [...prev, { 
      sender: 'System', text, 
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSystem: true 
    }]);
  };

  // --- 5. VIDEO SYNC HANDLERS ---
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
      roomId, sender: username, text: chatInput, 
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    };
    socket.emit('send-message', msgData);
    setChatInput('');
  };

  const leaveRoom = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    socket.disconnect();
    window.location.reload(); 
  };

  // --- RENDER SCREENS ---

  // LANDING PAGE (Not in Room)
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

          <div className="mt-8 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Your Name</label>
              <input
                type="text" required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            {/* JOIN EXISTING ROOM */}
            <form onSubmit={handleJoinRoom} className="space-y-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Join Existing Room</label>
                <div className="flex gap-2">
                  <input
                    type="text" required
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="Enter Room ID..."
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-lg transition-colors shadow-lg shadow-blue-900/20"
                  >
                    Join
                  </button>
                </div>
              </div>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500">Or Host a New Party</span></div>
            </div>

            {/* HOST NEW ROOM */}
            <label className="flex items-center justify-center w-full px-4 py-4 bg-slate-800 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-slate-800/80 transition-all shadow-lg">
              <Video className="mr-3 text-blue-400" size={24} />
              <span className="text-slate-200 font-medium">Select Video & Create Room</span>
              <input type="file" className="hidden" accept="video/*" onChange={handleHostNewRoom} />
            </label>
          </div>
        </div>
      </div>
    );
  }

  // MAIN WATCH PARTY ROOM
  return (
    <div className="flex h-screen bg-black text-slate-100 overflow-hidden font-sans">
      {/* MAIN PLAYER AREA */}
      <div className="flex-1 flex flex-col relative group">
        <div className="flex-1 bg-black flex items-center justify-center relative">
          {videoFile ? (
            <video 
              ref={videoRef} src={videoFile}
              className="max-h-full w-full"
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
          ) : (
            <div className="text-center p-8">
              <Video size={64} className="mx-auto text-slate-700 mb-4" />
              <h2 className="text-xl font-medium text-slate-400">Waiting for Host</h2>
              <p className="text-slate-600 mt-2">The host has not started the video yet.</p>
            </div>
          )}

          {/* VIDEO CONTROLS OVERLAY */}
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="space-y-4">
              <input 
                type="range" 
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                min="0" max={videoRef.current?.duration || 100}
                value={currentTime} onChange={handleSeek}
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
                    {copySuccess ? 'Copied!' : `Room: ${roomId}`}
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

      {/* SOCIAL SIDEBAR */}
      <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl z-10">
        <div className="p-4 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Users size={18} className="text-blue-400" />
              Watchers ({roomParticipants.length})
            </h3>
            <Settings size={18} className="text-slate-500 cursor-pointer hover:text-white" />
          </div>
          
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scrollbar-hide">
            {/* Local User Video */}
            <div className="aspect-video bg-slate-800 rounded-lg relative overflow-hidden ring-1 ring-slate-700">
              <video playsInline muted autoPlay ref={userVideoRef} className={`w-full h-full object-cover ${!isCameraOn && 'hidden'}`} />
              {!isCameraOn && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-800/50">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">{username[0]}</div>
                </div>
              )}
              <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1">
                <span className="text-[10px] truncate max-w-[50px] bg-black/50 px-1 rounded">You</span>
                <div className="flex gap-1">
                  {isMicOn ? <Mic size={10} className="text-blue-400" /> : <MicOff size={10} className="text-slate-500" />}
                </div>
              </div>
            </div>

            {/* Remote Peer Videos */}
            {peers.map((peerObj, index) => (
              <RemoteVideo key={index} peer={peerObj.peer} username={peerObj.username} />
            ))}
          </div>
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
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

          <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900 pb-6">
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
            
            {/* WEBRTC MEDIA TOGGLES */}
            <div className="flex justify-center gap-8 mt-5">
               <button 
                  type="button" 
                  onClick={() => toggleMedia('video')}
                  className={`transition-colors p-2 rounded-full hover:bg-slate-800 ${isCameraOn ? 'text-blue-400' : 'text-slate-500 hover:text-white'}`}
                >
                  {isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
               </button>
               <button 
                  type="button" 
                  onClick={() => toggleMedia('audio')}
                  className={`transition-colors p-2 rounded-full hover:bg-slate-800 ${isMicOn ? 'text-blue-400' : 'text-slate-500 hover:text-white'}`}
                >
                  {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
               </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Sub-component to handle React rendering of incoming streams
const RemoteVideo = ({ peer, username }) => {
  const ref = useRef();

  useEffect(() => {
    peer.on("stream", stream => {
      ref.current.srcObject = stream;
    });
  }, [peer]);

  return (
    <div className="aspect-video bg-slate-800 rounded-lg relative overflow-hidden ring-1 ring-slate-700">
      <video playsInline autoPlay ref={ref} className="w-full h-full object-cover" />
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1">
        <span className="text-[10px] truncate max-w-[50px] bg-black/50 px-1 rounded">{username}</span>
      </div>
    </div>
  );
};