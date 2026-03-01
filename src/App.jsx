import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import ReactPlayer from 'react-player';
import { 
  Play, Pause, Users, Video, VideoOff, Mic, MicOff, 
  Send, Share2, Settings, Monitor, LogOut, Check, Link, UploadCloud, HardDrive, AlertTriangle
} from 'lucide-react';

// 🚨 CRITICAL FIX: Put your RENDER (Backend) link here
const SOCKET_URL = "https://mywatchparty-backend.onrender.com"; 
const socket = io(SOCKET_URL, { autoConnect: false });

// Custom Native WebRTC wrapper to replace 'simple-peer'
// This fixes build errors and removes the need for outdated dependencies.
class NativePeer {
  constructor({ initiator, stream }) {
    this.pc = new RTCPeerConnection({ 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ] 
    });
    this.callbacks = { signal: [], stream: [] };
    
    if (stream) {
      stream.getTracks().forEach(track => this.pc.addTrack(track, stream));
    }

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.emit('signal', { type: 'candidate', candidate: e.candidate });
      }
    };

    this.pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        this.emit('stream', e.streams[0]);
      }
    };

    if (initiator) {
      this.pc.createOffer().then(offer => {
        return this.pc.setLocalDescription(offer);
      }).then(() => {
        this.emit('signal', { type: 'sdp', sdp: this.pc.localDescription });
      }).catch(console.error);
    }
  }

  on(event, cb) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(cb);
  }

  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(cb => cb(data));
    }
  }

  signal(data) {
    if (!data) return;
    if (data.type === 'sdp' || data.sdp) {
      this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp || data)).then(() => {
        if (this.pc.remoteDescription.type === 'offer') {
          return this.pc.createAnswer();
        }
      }).then(answer => {
        if (answer) {
          return this.pc.setLocalDescription(answer).then(() => {
            this.emit('signal', { type: 'sdp', sdp: this.pc.localDescription });
          });
        }
      }).catch(console.error);
    } else if (data.type === 'candidate' || data.candidate) {
      this.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
    }
  }

  destroy() {
    this.pc.close();
  }
}

export default function App() {
  // Global State
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('User_' + Math.floor(Math.random() * 1000));
  const [inRoom, setInRoom] = useState(false);
  
  // Hosting Inputs State
  const [hostMode, setHostMode] = useState('cloud'); // 'cloud', 'hosted', 'local'
  const [cloudUrlInput, setCloudUrlInput] = useState('');
  const [pendingVideoFile, setPendingVideoFile] = useState(null); 
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  // Room Video State
  const [videoConfig, setVideoConfig] = useState(null); // { type: 'url'|'hosted'|'local', url: '...' }
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Chat & WebRTC State
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [roomParticipants, setRoomParticipants] = useState([]); 
  const [peers, setPeers] = useState([]); 
  const [localStream, setLocalStream] = useState(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);

  // Refs
  const videoRef = useRef(null); // For native <video> (local/hosted MP4s)
  const reactPlayerRef = useRef(null); // For <ReactPlayer> (YouTube/Drive)
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
      // Automatically configure the guest's video player based on what the host set!
      if (state.videoState && state.videoState.type !== 'local') {
         setVideoConfig(state.videoState);
      } else if (state.videoState && state.videoState.type === 'local') {
         // Force guest to select local file
         setVideoConfig({ type: 'local', url: null });
      }
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
      // Logic for Native Video (Hosted MP4 / Local)
      if (videoRef.current) {
        if (Math.abs(videoRef.current.currentTime - data.currentTime) > 1) videoRef.current.currentTime = data.currentTime;
        videoRef.current.play().catch(e => console.log(e));
      }
      // Logic for ReactPlayer (YouTube)
      if (reactPlayerRef.current) {
        if (Math.abs(reactPlayerRef.current.getCurrentTime() - data.currentTime) > 1) reactPlayerRef.current.seekTo(data.currentTime);
      }
      setIsPlaying(true);
    });

    socket.on('sync-pause', () => {
      if (videoRef.current) videoRef.current.pause();
      setIsPlaying(false);
    });

    socket.on('sync-seek', (time) => {
      if (videoRef.current) videoRef.current.currentTime = time;
      if (reactPlayerRef.current) reactPlayerRef.current.seekTo(time);
      setCurrentTime(time);
    });

    socket.on('new-message', (msg) => setMessages(prev => [...prev, msg]));

    return () => {
      socket.off('user-joined'); socket.off('room-state'); socket.off('user-disconnected');
      socket.off('sync-play'); socket.off('sync-pause'); socket.off('sync-seek'); socket.off('new-message');
    };
  }, []);

  // --- 2. WEBRTC MEDIA & PEERS ---
  useEffect(() => {
    socket.on('user-joined-rtc', payload => {
      if (localStream) {
        const peer = addPeer(payload.signal, payload.callerID, localStream);
        peersRef.current.push({ peerID: payload.callerID, peer, username: payload.username });
        setPeers([...peersRef.current]);
      }
    });
    socket.on('receiving-returned-signal', payload => {
      const item = peersRef.current.find(p => p.peerID === payload.id);
      if (item) item.peer.signal(payload.signal);
    });
    return () => { socket.off('user-joined-rtc'); socket.off('receiving-returned-signal'); };
  }, [localStream]);

  const toggleMedia = async (type) => {
    try {
      if (!localStream) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getVideoTracks()[0].enabled = type === 'video';
        stream.getAudioTracks()[0].enabled = type === 'audio';
        setLocalStream(stream); setIsCameraOn(type === 'video'); setIsMicOn(type === 'audio');
        if (userVideoRef.current) userVideoRef.current.srcObject = stream;

        const newPeers = [];
        roomParticipants.forEach(user => {
          if (user.id !== socket.id) {
            const peer = createPeer(user.id, socket.id, stream);
            peersRef.current.push({ peerID: user.id, peer, username: user.name });
            newPeers.push({ peerID: user.id, peer, username: user.name });
          }
        });
        setPeers(newPeers);
      } else {
        if (type === 'video') { localStream.getVideoTracks()[0].enabled = !isCameraOn; setIsCameraOn(!isCameraOn); } 
        else if (type === 'audio') { localStream.getAudioTracks()[0].enabled = !isMicOn; setIsMicOn(!isMicOn); }
      }
    } catch (err) { alert("Could not access camera/microphone."); }
  };

  const createPeer = (userToSignal, callerID, stream) => {
    const peer = new NativePeer({ initiator: true, stream });
    peer.on('signal', signal => socket.emit('sending-signal', { userToSignal, callerID, signal, username }));
    return peer;
  };

  const addPeer = (incomingSignal, callerID, stream) => {
    const peer = new NativePeer({ initiator: false, stream });
    peer.on('signal', signal => socket.emit('returning-signal', { signal, callerID }));
    peer.signal(incomingSignal);
    return peer;
  };

  // --- 3. UI HANDLERS (JOIN & HOST) ---
  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (!username.trim() || !roomId.trim()) return alert("Enter Name and Room ID!");
    socket.connect();
    socket.emit('join-room', roomId, username, null); // Guests send null state
    setInRoom(true);
  };

  const handleCreateRoom = async () => {
    if (!username.trim()) return alert("Please enter your name first!");
    const generatedRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    let initialVideoState = null;

    if (hostMode === 'cloud') {
      if (!cloudUrlInput) return alert("Paste a YouTube or Video URL first!");
      initialVideoState = { type: 'url', url: cloudUrlInput };
      
    } else if (hostMode === 'hosted') {
      if (!pendingVideoFile) return alert("Select a video file to upload!");
      if (pendingVideoFile.size > 50 * 1024 * 1024) return alert("File exceeds 50MB limit!");
      if (!agreedToTerms) return alert("You must agree to the Responsibility Terms!");
      
      setIsUploading(true);
      const formData = new FormData();
      formData.append('video', pendingVideoFile);

      try {
        const res = await fetch(`${SOCKET_URL}/api/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        initialVideoState = { type: 'hosted', url: `${SOCKET_URL}${data.url}` };
      } catch (err) {
        setIsUploading(false);
        return alert("Failed to upload video to server.");
      }
      setIsUploading(false);

    } else if (hostMode === 'local') {
      if (!pendingVideoFile) return alert("Select a local video file!");
      const localUrl = URL.createObjectURL(pendingVideoFile);
      initialVideoState = { type: 'local', url: localUrl };
    }

    setVideoConfig(initialVideoState);
    setRoomId(generatedRoomId);
    socket.connect();
    socket.emit('join-room', generatedRoomId, username, initialVideoState);
    setInRoom(true);
  };

  const addSystemMessage = (text) => setMessages(prev => [...prev, { sender: 'System', text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isSystem: true }]);

  // --- 4. VIDEO SYNC HANDLERS ---
  const togglePlay = () => {
    const isActuallyPlaying = !isPlaying;
    setIsPlaying(isActuallyPlaying);
    
    // Determine current time based on which player is active
    let cTime = currentTime;
    if (videoConfig?.type === 'url' && reactPlayerRef.current) cTime = reactPlayerRef.current.getCurrentTime();
    else if (videoRef.current) cTime = videoRef.current.currentTime;

    if (isActuallyPlaying) {
      if (videoRef.current) videoRef.current.play();
      socket.emit('video-play', { roomId, currentTime: cTime });
    } else {
      if (videoRef.current) videoRef.current.pause();
      socket.emit('video-pause', { roomId });
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoConfig?.type === 'url' && reactPlayerRef.current) reactPlayerRef.current.seekTo(time);
    else if (videoRef.current) videoRef.current.currentTime = time;
    socket.emit('video-seek', { roomId, currentTime: time });
  };

  // --- 5. RENDER SCREENS ---

  // LANDING PAGE (Not in Room)
  if (!inRoom) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans text-slate-100 py-12">
        <div className="max-w-md w-full bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-xl mb-4">
              <Monitor size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Mywatchparty</h1>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Your Name</label>
              <input type="text" required className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>

            <div className="border-t border-slate-800 pt-6"></div>

            {/* JOIN ROOM */}
            <form onSubmit={handleJoinRoom}>
              <label className="block text-sm font-medium text-slate-300 mb-1">Join Existing Room</label>
              <div className="flex gap-2">
                <input type="text" required className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Room ID..." value={roomId} onChange={(e) => setRoomId(e.target.value)} />
                <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-lg">Join</button>
              </div>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500">OR HOST A NEW PARTY</span></div>
            </div>

            {/* HOSTING OPTIONS */}
            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-4">
              {/* Tabs */}
              <div className="flex bg-slate-900 rounded-lg p-1 gap-1">
                <button onClick={() => setHostMode('cloud')} className={`flex-1 flex items-center justify-center py-2 text-xs font-medium rounded-md transition-all ${hostMode === 'cloud' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}><Link size={14} className="mr-1"/> Cloud Link</button>
                <button onClick={() => setHostMode('hosted')} className={`flex-1 flex items-center justify-center py-2 text-xs font-medium rounded-md transition-all ${hostMode === 'hosted' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}><UploadCloud size={14} className="mr-1"/> Server 50MB</button>
                <button onClick={() => setHostMode('local')} className={`flex-1 flex items-center justify-center py-2 text-xs font-medium rounded-md transition-all ${hostMode === 'local' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}><HardDrive size={14} className="mr-1"/> Local Sync</button>
              </div>

              {/* Tab Contents */}
              {hostMode === 'cloud' && (
                <div>
                  <input type="text" placeholder="Paste YouTube or MP4 Link..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white mb-2 outline-none" value={cloudUrlInput} onChange={(e) => setCloudUrlInput(e.target.value)} />
                  <p className="text-xs text-slate-400 mb-4">Plays instantly for everyone in the room.</p>
                </div>
              )}

              {hostMode === 'hosted' && (
                <div>
                  <input type="file" id="vid-upload-server" className="hidden" accept="video/*" onChange={(e) => setPendingVideoFile(e.target.files[0])} />
                  <label htmlFor="vid-upload-server" className="flex items-center justify-center w-full px-4 py-3 bg-slate-900 border border-dashed border-slate-600 rounded-lg cursor-pointer hover:border-blue-500 transition-all mb-3 text-sm">
                    {pendingVideoFile ? pendingVideoFile.name : "Choose File (Max 50MB)"}
                  </label>
                  <label className="flex items-start gap-2 text-xs text-slate-400 mb-4 cursor-pointer">
                    <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} className="mt-0.5 accent-blue-600" />
                    <span>I understand this file will be uploaded to a public server, auto-deleted in 24 hours, and I am responsible for the content.</span>
                  </label>
                </div>
              )}

              {hostMode === 'local' && (
                <div>
                  <input type="file" id="vid-upload-local" className="hidden" accept="video/*" onChange={(e) => setPendingVideoFile(e.target.files[0])} />
                  <label htmlFor="vid-upload-local" className="flex items-center justify-center w-full px-4 py-3 bg-slate-900 border border-dashed border-slate-600 rounded-lg cursor-pointer hover:border-blue-500 transition-all mb-2 text-sm">
                    {pendingVideoFile ? pendingVideoFile.name : "Choose Local File (No Size Limit)"}
                  </label>
                  <p className="text-xs text-slate-400 mb-4">Zero-lag. Guests must select the same file on their device.</p>
                </div>
              )}

              <button onClick={handleCreateRoom} disabled={isUploading} className="w-full bg-green-600 hover:bg-green-500 disabled:bg-slate-700 text-white font-semibold py-3 rounded-lg transition-colors shadow-lg flex justify-center items-center">
                {isUploading ? <span className="animate-pulse">Uploading to Server...</span> : "Create Room & Host"}
              </button>
            </div>
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
          
          {/* THE DYNAMIC VIDEO PLAYER */}
          {videoConfig?.type === 'url' ? (
            <ReactPlayer 
              ref={reactPlayerRef} url={videoConfig.url} playing={isPlaying} 
              width="100%" height="100%" 
              onProgress={(e) => setCurrentTime(e.playedSeconds)}
              onDuration={setDuration}
              style={{ pointerEvents: 'none' }} // Prevents user from clicking default YouTube controls
            />
          ) : (videoConfig?.type === 'hosted' || (videoConfig?.type === 'local' && videoConfig?.url)) ? (
            <video 
              ref={videoRef} src={videoConfig.url} className="max-h-full w-full"
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
              onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
              onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
            />
          ) : (
             <div className="text-center p-8">
              <label className="cursor-pointer inline-flex flex-col items-center">
                <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center hover:bg-slate-700 transition-colors mb-4 shadow-xl"><Video size={32} className="text-blue-500" /></div>
                <h2 className="text-2xl font-medium text-slate-200">Select the Local Movie File</h2>
                <input type="file" className="hidden" accept="video/*" onChange={(e) => {
                   if (e.target.files[0]) setVideoConfig({ type: 'local', url: URL.createObjectURL(e.target.files[0]) });
                }} />
              </label>
              <div className="mt-6 max-w-md mx-auto bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
                <p className="text-blue-200 text-sm"><strong>Zero-Lag Sync:</strong> The host chose Local Sync. Please select the exact same video file as the host to sync playback.</p>
              </div>
            </div>
          )}

          {/* CUSTOM VIDEO CONTROLS OVERLAY */}
          {videoConfig?.url && (
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="space-y-4">
                <input 
                  type="range" className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  min="0" max={duration || 100} value={currentTime} onChange={handleSeek}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <button onClick={togglePlay} className="hover:text-blue-400 transition-colors">
                      {isPlaying ? <Pause size={28} /> : <Play size={28} />}
                    </button>
                    <span className="text-sm font-mono">
                      {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} / 
                      {` ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?room=${roomId}`); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); }} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm transition-all">
                      {copySuccess ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
                      {copySuccess ? 'Copied!' : `Room: ${roomId}`}
                    </button>
                    <button onClick={() => window.location.reload()} className="text-slate-400 hover:text-red-400 transition-colors"><LogOut size={24} /></button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SOCIAL SIDEBAR */}
      <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl z-10">
        <div className="p-4 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><Users size={18} className="text-blue-400" />Watchers ({roomParticipants.length})</h3>
            <Settings size={18} className="text-slate-500 cursor-pointer hover:text-white" />
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scrollbar-hide">
            {/* Local WebRTC Video */}
            <div className="aspect-video bg-slate-800 rounded-lg relative overflow-hidden ring-1 ring-slate-700">
              <video playsInline muted autoPlay ref={userVideoRef} className={`w-full h-full object-cover ${!isCameraOn && 'hidden'}`} />
              {!isCameraOn && <div className="absolute inset-0 flex items-center justify-center bg-slate-800/50"><div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">{username[0]}</div></div>}
              <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1">
                <span className="text-[10px] truncate max-w-[50px] bg-black/50 px-1 rounded">You</span>
                <div className="flex gap-1">{isMicOn ? <Mic size={10} className="text-blue-400" /> : <MicOff size={10} className="text-slate-500" />}</div>
              </div>
            </div>
            {/* Remote WebRTC Videos */}
            {peers.map((peerObj, index) => <RemoteVideo key={index} peer={peerObj.peer} username={peerObj.username} />)}
          </div>
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            {messages.length === 0 && <div className="text-center py-10 opacity-30"><Send size={32} className="mx-auto mb-2" /><p className="text-xs">No messages yet</p></div>}
            {messages.map((msg, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between"><span className={`text-xs font-bold ${msg.isSystem ? 'text-slate-500' : 'text-blue-400'}`}>{msg.sender}</span><span className="text-[10px] text-slate-500">{msg.time}</span></div>
                {!msg.isSystem && <p className="text-sm bg-slate-800 p-2 rounded-lg rounded-tl-none">{msg.text}</p>}
                {msg.isSystem && <p className="text-xs text-slate-500 italic">{msg.text}</p>}
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (!chatInput.trim()) return; socket.emit('send-message', { roomId, sender: username, text: chatInput, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }); setChatInput(''); }} className="p-4 border-t border-slate-800 bg-slate-900 pb-6">
            <div className="flex gap-2">
              <input type="text" placeholder="Type a message..." className="flex-1 bg-slate-800 border-none rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none" value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
              <button type="submit" className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg transition-colors"><Send size={18} /></button>
            </div>
            <div className="flex justify-center gap-8 mt-5">
               <button type="button" onClick={() => toggleMedia('video')} className={`transition-colors p-2 rounded-full hover:bg-slate-800 ${isCameraOn ? 'text-blue-400' : 'text-slate-500'}`}>{isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}</button>
               <button type="button" onClick={() => toggleMedia('audio')} className={`transition-colors p-2 rounded-full hover:bg-slate-800 ${isMicOn ? 'text-blue-400' : 'text-slate-500'}`}>{isMicOn ? <Mic size={20} /> : <MicOff size={20} />}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Render incoming WebRTC Streams
const RemoteVideo = ({ peer, username }) => {
  const ref = useRef();
  useEffect(() => { peer.on("stream", stream => { ref.current.srcObject = stream; }); }, [peer]);
  return (
    <div className="aspect-video bg-slate-800 rounded-lg relative overflow-hidden ring-1 ring-slate-700">
      <video playsInline autoPlay ref={ref} className="w-full h-full object-cover" />
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-1">
        <span className="text-[10px] truncate max-w-[50px] bg-black/50 px-1 rounded">{username}</span>
      </div>
    </div>
  );
};