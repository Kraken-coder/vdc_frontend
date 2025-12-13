import { useState, useEffect, useRef } from 'react'
import './App.css'

const WEBSOCKET_URL = 'wss://1wjlhg244i.execute-api.ap-south-1.amazonaws.com/production/'

function App() {
  const [ws, setWs] = useState(null)
  const [connected, setConnected] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [messages, setMessages] = useState([])
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [messageInput, setMessageInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [notification, setNotification] = useState(null)
  const [userInfo, setUserInfo] = useState({})
  const [showUserInfo, setShowUserInfo] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState(3000)
  const [paymentDuration, setPaymentDuration] = useState('30')
  const [chatMessages, setChatMessages] = useState([])
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const selectedPhoneRef = useRef(null)

  // Keep ref in sync with state
  useEffect(() => {
    selectedPhoneRef.current = selectedPhone
  }, [selectedPhone])

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, selectedPhone])

  // WebSocket connection
  useEffect(() => {
    connectWebSocket()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (ws) {
        ws.close()
      }
    }
  }, [])

  const connectWebSocket = () => {
    try {
      const websocket = new WebSocket(WEBSOCKET_URL)

      websocket.onopen = () => {
        console.log('WebSocket Connected')
        setConnected(true)
        setWs(websocket)
        
        showNotification('Connected to server', 'success')
      }

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('Received:', data)

          // Handle authentication response
          if (data.action === 'auth_response') {
            if (data.success) {
              setAuthenticated(true)
              showNotification('Authentication successful', 'success')
              
              // Request all messages after successful auth
              websocket.send(JSON.stringify({
                action: 'get_all_messages',
                limit: 1000,
                table_name: 'MessagesLogs'
              }))
            } else {
              showNotification('Authentication failed: ' + (data.message || 'Invalid credentials'), 'error')
              websocket.close()
            }
          }

          // Handle initial data load
          if (data.action === 'get_data_response' || data.action === 'get_data_response    ') {
            if (data.data && Array.isArray(data.data)) {
              // Handle chunked data
              if (data.chunk_index !== undefined) {
                if (data.chunk_index === 0) {
                  setMessages(data.data)
                } else {
                  setMessages(prev => [...prev, ...data.data])
                }
                console.log(`Received chunk ${data.chunk_index + 1}/${data.total_chunks} with ${data.data.length} messages`)
              } else {
                // Legacy support for non-chunked data
                setMessages(data.data)
              }
              
              // Extract unique phone numbers and fetch user info for each
              const uniquePhones = [...new Set(data.data.map(msg => msg.phone_number))]
              console.log(`Fetching user info for ${uniquePhones.length} users`)
              
              // Fetch user info for all unique phone numbers
              uniquePhones.forEach(phone => {
                if (phone) {
                  websocket.send(JSON.stringify({
                    action: 'get_user_info',
                    phone: phone
                  }))
                }
              })
            }
          }
          
          // Handle user info response
          if (data.action === 'user_info_response') {
            console.log('Received user info:', data)
            if (data.data) {
              // Extract phone number from the data
              let phoneNumber = data.data["Please enter your what's app number"]
              
              if (phoneNumber) {
                // Ensure phone number is a string and has country code
                phoneNumber = phoneNumber.toString()
                
                // If phone number doesn't start with 91, add it
                if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
                  phoneNumber = '91' + phoneNumber
                }
                
                console.log('Storing user info for phone:', phoneNumber)
                setUserInfo(prev => ({
                  ...prev,
                  [phoneNumber]: data.data
                }))
              } else {
                // Fallback to selectedPhone if phone number not in data
                console.log('Storing user info for selectedPhone:', selectedPhone)
                setUserInfo(prev => ({
                  ...prev,
                  [selectedPhone]: data.data
                }))
              }
            }
          }
          
          // Handle selected user chat response (pagination)
          if (data.action === 'selected_user_chat_response') {
            if (data.data && Array.isArray(data.data)) {
              if (data.data.length === 0) {
                setHasMoreMessages(false)
              } else {
                setChatMessages(prev => {
                  const isInitialLoad = prev.length === 0
                  const newMessages = [...data.data, ...prev]
                  
                  // Scroll to bottom after initial load (when clicking a conversation)
                  if (isInitialLoad) {
                    setTimeout(() => scrollToBottom(), 100)
                  }
                  
                  return newMessages
                })
              }
              setLoadingMoreMessages(false)
            }
          }
          
          // Handle payment link response
          if (data.action === 'payment_link_response') {
            if (data.status === 'success') {
              showNotification('Payment link sent successfully', 'success')
            } else {
              showNotification('Failed to send payment link', 'error')
            }
          }

          // Handle real-time updates from DynamoDB
          if (data.type === 'dynamodb_update' && data.action === 'new_message') {
            const newMessage = data.data
            const currentSelectedPhone = selectedPhoneRef.current
            
            console.log('📨 Received new message:', {
              phone: newMessage.phone_number,
              source: newMessage.source,
              messagePreview: newMessage.message?.substring(0, 30),
              currentSelectedPhone,
              isForCurrentChat: newMessage.phone_number === currentSelectedPhone
            })
            
            // Check if message already exists to prevent duplicates
            setMessages(prev => {
              const isDuplicate = prev.some(msg => 
                msg.phone_number === newMessage.phone_number &&
                msg.timestamp === newMessage.timestamp &&
                msg.message === newMessage.message &&
                msg.source === newMessage.source
              )
              
              if (isDuplicate) {
                console.log('⚠️ Duplicate message detected in main list, skipping...')
                return prev
              }
              
              console.log('✅ Adding message to sidebar list')
              return [newMessage, ...prev]
            })
            
            // Also update chat messages if this conversation is selected
            if (newMessage.phone_number === currentSelectedPhone) {
              console.log('🔄 Updating chat messages for current conversation')
              setChatMessages(prev => {
                console.log('Current chat messages count:', prev.length)
                
                // Simple duplicate check - exact match on timestamp, message, and source
                const isDuplicate = prev.some(msg => 
                  msg.timestamp === newMessage.timestamp &&
                  msg.message === newMessage.message &&
                  msg.source === newMessage.source
                )
                
                if (isDuplicate) {
                  console.log('⚠️ Duplicate message detected in chat, skipping...')
                  return prev
                }
                console.log('✅ Adding new message to chat:', newMessage.message.substring(0, 50))
                return [...prev, newMessage]
              })
              
              // Scroll to bottom when new message arrives
              setTimeout(() => scrollToBottom(), 100)
            } else {
              console.log('ℹ️ Message is for different conversation, not updating chat view')
            }
            
            // Show notification for new message from OTHER conversations (not currently selected)
            if (newMessage.source !== 'Human_Intervention' && newMessage.phone_number !== currentSelectedPhone) {
              showNotification(`New message from ${formatPhoneNumber(newMessage.phone_number)}`, 'info')
            }
          }
        } catch (error) {
          console.error('Error parsing message:', error)
        }
      }

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error)
        showNotification('Connection error', 'error')
      }

      websocket.onclose = () => {
        console.log('WebSocket disconnected')
        setConnected(false)
        setAuthenticated(false)
        setWs(null)
        showNotification('Disconnected from server', 'warning')
        
        // Attempt to reconnect after 3 seconds only if was authenticated
        if (authenticated) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect...')
            connectWebSocket()
          }, 3000)
        }
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      showNotification('Failed to connect', 'error')
    }
  }

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  const handleLogin = (e) => {
    e.preventDefault()
    
    if (!username.trim() || !password.trim()) {
      showNotification('Please enter username and password', 'error')
      return
    }

    if (!ws || !connected) {
      showNotification('Not connected to server', 'error')
      return
    }

    // Send authentication request
    ws.send(JSON.stringify({
      action: 'authenticate',
      username: username.trim(),
      password: password.trim()
    }))
  }

  const sendMessage = () => {
    if (!messageInput.trim() || !selectedPhone || !ws || !connected) return

    const payload = {
      action: 'send_message',
      phone: selectedPhone,
      message: messageInput.trim()
    }

    ws.send(JSON.stringify(payload))
    showNotification('Sending message...', 'info')
    setMessageInput('')
  }

  const fetchUserInfo = (phone) => {
    if (!ws || !connected) return
    
    console.log('Fetching user info for:', phone)
    const payload = {
      action: 'get_user_info',
      phone: phone
    }
    
    ws.send(JSON.stringify(payload))
  }

  const fetchChatMessages = (phone, timestamp = null) => {
    if (!ws || !connected) return
    
    const payload = {
      action: 'get_selected_user_chat',
      phone: phone,
      timestamp: timestamp || new Date().toISOString()
    }
    
    ws.send(JSON.stringify(payload))
  }

  const sendPaymentLink = () => {
    if (!selectedPhone || !ws || !connected) return

    const payload = {
      action: 'send_payment_link',
      phone: selectedPhone,
      amount: parseInt(paymentAmount) * 100,  // Convert rupees to paise
      duration: paymentDuration
    }

    ws.send(JSON.stringify(payload))
    showNotification('Sending payment link...', 'info')
    setShowPaymentModal(false)
  }

  const loadMoreMessages = () => {
    if (!selectedPhone || loadingMoreMessages || !hasMoreMessages) return
    
    setLoadingMoreMessages(true)
    const oldestMessage = chatMessages[0]
    if (oldestMessage) {
      fetchChatMessages(selectedPhone, oldestMessage.timestamp)
    }
  }

  const handleScroll = () => {
    const container = messagesContainerRef.current
    if (!container) return
    
    // Check if user scrolled to top
    if (container.scrollTop === 0 && hasMoreMessages && !loadingMoreMessages) {
      loadMoreMessages()
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Get unique phone numbers with message counts
  const getConversations = () => {
    const phoneMap = new Map()
    
    messages.forEach(msg => {
      const phone = msg.phone_number
      if (!phoneMap.has(phone)) {
        phoneMap.set(phone, {
          phone,
          messages: [],
          lastMessage: msg,
          unreadCount: 0
        })
      }
      phoneMap.get(phone).messages.push(msg)
    })

    return Array.from(phoneMap.values()).sort((a, b) => 
      new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp)
    )
  }

  const getMessagesForPhone = (phone) => {
    return messages
      .filter(msg => msg.phone_number === phone)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  }

  const getUserName = (phone) => {
    if (userInfo[phone] && userInfo[phone].Name) {
      return userInfo[phone].Name
    }
    return formatPhoneNumber(phone)
  }

  const formatPhoneNumber = (phone) => {
    if (!phone) return 'Unknown'
    // Format: +91 83403 46515
    if (phone.startsWith('91') && phone.length === 12) {
      return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`
    }
    return phone
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now - date
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    
    if (diff < 86400000) { // Less than 24 hours
      return `${hours}:${minutes}`
    } else if (diff < 604800000) { // Less than 7 days
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      return `${days[date.getDay()]} ${hours}:${minutes}`
    } else {
      return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`
    }
  }

  const truncateMessage = (text, maxLength = 50) => {
    if (!text) return ''
    const cleaned = cleanMessageText(text)
    if (cleaned.length <= maxLength) return cleaned
    return cleaned.substring(0, maxLength) + '...'
  }

  const cleanMessageText = (text) => {
    if (!text) return ''
    
    let cleanedText = text
    
    // Remove AIresponse=" prefix and recipes=None suffix if present
    if (cleanedText.startsWith('AIresponse="') || cleanedText.startsWith('AIresponse=\'')) {
      cleanedText = cleanedText.replace(/^AIresponse=["']/, '')
    }
    if (cleanedText.endsWith('" recipes=None') || cleanedText.endsWith('\' recipes=None')) {
      cleanedText = cleanedText.replace(/["']\s*recipes=None$/, '')
    }
    
    // Remove "User :" prefix if present
    if (cleanedText.startsWith('User :')) {
      cleanedText = cleanedText.replace(/^User\s*:\s*/, '')
    }
    
    // Remove System prompt prefix if present
    if (cleanedText.includes('System prompt :')) {
      cleanedText = cleanedText.replace(/System prompt\s*:.*?User prompt\s*:/s, '')
    }
    
    // Replace escaped unicode sequences
    cleanedText = cleanedText.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => {
      return String.fromCharCode(parseInt(grp, 16))
    })
    
    // Replace escaped newlines with actual newlines
    cleanedText = cleanedText.replace(/\\n/g, '\n')
    cleanedText = cleanedText.replace(/\\r/g, '')
    
    // Replace multiple consecutive newlines with just two
    cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n')
    
    // Trim whitespace
    cleanedText = cleanedText.trim()
    
    return cleanedText
  }

  const renderFormattedMessage = (text) => {
    if (!text) return null
    
    const cleanedText = cleanMessageText(text)
    
    // Split by lines to preserve formatting
    const lines = cleanedText.split('\n')
    
    return lines.map((line, lineIndex) => {
      if (!line.trim()) {
        // Empty line for spacing
        return <div key={`empty-${lineIndex}`} className="message-line empty-line"></div>
      }
      
      // Process bold text (text between * * but not escaped \*)
      const parts = []
      let lastIndex = 0
      let partKey = 0
      
      // More sophisticated regex to handle bold with emojis
      // Matches *text* where text can contain any characters except newlines
      const boldRegex = /\*([^*\n]+?)\*/g
      let match
      
      while ((match = boldRegex.exec(line)) !== null) {
        // Add text before the bold part
        if (match.index > lastIndex) {
          const beforeText = line.substring(lastIndex, match.index)
          if (beforeText) {
            parts.push(
              <span key={`${lineIndex}-text-${partKey++}`}>
                {beforeText}
              </span>
            )
          }
        }
        
        // Add bold text (including emojis)
        parts.push(
          <strong key={`${lineIndex}-bold-${partKey++}`}>
            {match[1]}
          </strong>
        )
        
        lastIndex = match.index + match[0].length
      }
      
      // Add remaining text after last bold
      if (lastIndex < line.length) {
        const remainingText = line.substring(lastIndex)
        if (remainingText) {
          parts.push(
            <span key={`${lineIndex}-text-${partKey++}`}>
              {remainingText}
            </span>
          )
        }
      }
      
      // If no bold formatting was found, just return the line as-is
      if (parts.length === 0) {
        return (
          <div key={`line-${lineIndex}`} className="message-line">
            {line}
          </div>
        )
      }
      
      return (
        <div key={`line-${lineIndex}`} className="message-line">
          {parts}
        </div>
      )
    })
  }

  const conversations = getConversations()
  const filteredConversations = conversations.filter(conv => {
    const userName = getUserName(conv.phone).toLowerCase()
    const query = searchQuery.toLowerCase()
    return (
      conv.phone.includes(searchQuery) ||
      userName.includes(query) ||
      conv.lastMessage.message?.toLowerCase().includes(query)
    )
  })

  return (
    <div className="app">
      {/* Notification */}
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="app-header">
        <h1>VDC Dashboard</h1>
        <div className="connection-status">
          <div className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}></div>
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      {/* Login Screen */}
      {!authenticated ? (
        <div className="login-container">
          <div className="login-box">
            <h2>Admin Login</h2>
            <p className="login-subtitle">Please enter your credentials to access the dashboard</p>
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="login-input"
                  disabled={!connected}
                  autoComplete="username"
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="login-input"
                  disabled={!connected}
                  autoComplete="current-password"
                />
              </div>
              <button 
                type="submit" 
                className="login-button"
                disabled={!connected || !username.trim() || !password.trim()}
              >
                {connected ? 'Login' : 'Connecting...'}
              </button>
            </form>
          </div>
        </div>
      ) : (
      <div className="app-container">
        {/* Mobile Menu Button */}
        <button 
          className="mobile-menu-button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label="Toggle sidebar"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Sidebar - Conversations List */}
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <h2>Conversations</h2>
            <div className="conversation-count">{conversations.length}</div>
            <button 
              className="close-sidebar-button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Close sidebar"
            >
              ×
            </button>
          </div>
          
          <div className="search-container">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="conversations-list">
            {filteredConversations.length === 0 ? (
              <div className="empty-state">
                <p>No conversations found</p>
              </div>
            ) : (
              filteredConversations.map(conv => (
                <div
                  key={conv.phone}
                  className={`conversation-item ${selectedPhone === conv.phone ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedPhone(conv.phone)
                    setChatMessages([])
                    setHasMoreMessages(true)
                    fetchUserInfo(conv.phone)
                    fetchChatMessages(conv.phone)
                    // Close sidebar on mobile after selection
                    if (window.innerWidth <= 768) {
                      setSidebarCollapsed(true)
                    }
                  }}
                >
                  <div className="conversation-avatar">
                    {conv.phone.slice(-2)}
                  </div>
                  <div className="conversation-info">
                    <div className="conversation-header">
                      <span className="conversation-name">
                        {getUserName(conv.phone)}
                      </span>
                      <span className="conversation-time">
                        {formatTime(conv.lastMessage.timestamp)}
                      </span>
                    </div>
                    <div className="conversation-preview">
                      <span className={`message-source ${conv.lastMessage.source}`}>
                        {conv.lastMessage.source === 'AI' ? '🤖' : '👤'}
                      </span>
                      <span className="message-text">
                        {truncateMessage(conv.lastMessage.message)}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="unread-badge">{conv.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="chat-area">
          {selectedPhone ? (
            <>
              {/* Chat Header */}
              <div className="chat-header">
                <div className="chat-user-info">
                  <div className="chat-avatar">
                    {selectedPhone.slice(-2)}
                  </div>
                  <div>
                    <h3>{getUserName(selectedPhone)}</h3>
                    <p className="user-status">
                      {formatPhoneNumber(selectedPhone)} • {chatMessages.length} messages
                    </p>
                  </div>
                </div>
                <button 
                  className="payment-button"
                  onClick={() => setShowPaymentModal(true)}
                  title="Send Payment Link"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                    <line x1="1" y1="10" x2="23" y2="10"></line>
                  </svg>
                </button>
                <button 
                  className="info-button"
                  onClick={() => {
                    console.log('Info button clicked. Current state:', {
                      showUserInfo,
                      selectedPhone,
                      hasUserInfo: !!userInfo[selectedPhone],
                      userInfo: userInfo[selectedPhone]
                    })
                    setShowUserInfo(!showUserInfo)
                  }}
                  title="View User Info"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                    <path d="M12 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <circle cx="12" cy="8" r="1" fill="currentColor"/>
                  </svg>
                </button>
              </div>

              <div className="chat-content">
                {/* User Info Panel */}
                {showUserInfo && (
                  <div className="user-info-panel">
                    <div className="user-info-header">
                      <h3>User Information</h3>
                      <button 
                        className="close-button"
                        onClick={() => setShowUserInfo(false)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="user-info-content">
                      {userInfo[selectedPhone] ? (
                        <>
                      {userInfo[selectedPhone].Name && (
                        <div className="info-item">
                          <span className="info-label">Name:</span>
                          <span className="info-value">{userInfo[selectedPhone].Name}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Age (years)'] && (
                        <div className="info-item">
                          <span className="info-label">Age:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Age (years)']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Biological sex '] && (
                        <div className="info-item">
                          <span className="info-label">Gender:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Biological sex ']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Email address'] && (
                        <div className="info-item">
                          <span className="info-label">Email:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Email address']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Height (cm)'] && (
                        <div className="info-item">
                          <span className="info-label">Height:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Height (cm)']} cm</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Weight (kg)'] && (
                        <div className="info-item">
                          <span className="info-label">Weight:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Weight (kg)']} kg</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Reason for joining'] && (
                        <div className="info-item">
                          <span className="info-label">Goal:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Reason for joining']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Food Type'] && (
                        <div className="info-item">
                          <span className="info-label">Food Type:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Food Type']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Physical Activity Levels'] && (
                        <div className="info-item">
                          <span className="info-label">Activity Level:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Physical Activity Levels']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Health Problems'] && (
                        <div className="info-item">
                          <span className="info-label">Health Issues:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Health Problems']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Allergies from Food. None for no allergies'] && (
                        <div className="info-item">
                          <span className="info-label">Allergies:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Allergies from Food. None for no allergies']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone]['Blood Group'] && (
                        <div className="info-item">
                          <span className="info-label">Blood Group:</span>
                          <span className="info-value">{userInfo[selectedPhone]['Blood Group']}</span>
                        </div>
                      )}
                      {userInfo[selectedPhone].Occupation && (
                        <div className="info-item">
                          <span className="info-label">Occupation:</span>
                          <span className="info-value">{userInfo[selectedPhone].Occupation}</span>
                        </div>
                      )}
                      </>
                      ) : (
                        <div className="loading-indicator">
                          <div className="spinner"></div>
                          Loading user information...
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Messages Area */}
              <div className="messages-area">
              <div 
                className="messages-container" 
                ref={messagesContainerRef}
                onScroll={handleScroll}
              >
                {loadingMoreMessages && (
                  <div className="loading-indicator">
                    <div className="spinner"></div>
                    Loading older messages...
                  </div>
                )}
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`message ${msg.source === 'Human_Intervention' ? 'sent' : 'received'}`}
                  >
                    <div className="message-content">
                      <div className="message-header">
                        <span className="message-source-label">
                          {msg.source === 'AI' ? '🤖 AI' : 
                           msg.source === 'Human_Intervention' ? '👨‍💼 Agent' : '👤 User'}
                        </span>
                      </div>
                      <div className="message-text">
                        {renderFormattedMessage(msg.message)}
                      </div>
                      <div className="message-time">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              </div>
              </div>

              {/* Message Input */}
              <div className="message-input-container">
                <textarea
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="message-input"
                  rows="3"
                  disabled={!connected}
                />
                <button
                  onClick={sendMessage}
                  className="send-button"
                  disabled={!connected || !messageInput.trim()}
                  aria-label="Send message"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>Send</span>
                </button>
              </div>
            </>
          ) : (
            <div className="empty-chat">
              <div className="empty-chat-icon">💬</div>
              <h2>Select a conversation</h2>
              <p>Choose a conversation from the list to start messaging</p>
            </div>
          )}
        </div>
      </div>
      )}
      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Send Payment Link</h3>
              <button 
                className="close-button"
                onClick={() => setShowPaymentModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="amount">Amount (INR)</label>
                <input
                  id="amount"
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="login-input"
                  min="1"
                />
              </div>
              <div className="form-group">
                <label htmlFor="duration">Duration (Days)</label>
                <select
                  id="duration"
                  value={paymentDuration}
                  onChange={(e) => setPaymentDuration(e.target.value)}
                  className="login-input"
                >
                  <option value="30">30 Days</option>
                  <option value="60">60 Days</option>
                  <option value="90">90 Days</option>
                  <option value="180">180 Days</option>
                  <option value="365">365 Days</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="modal-button secondary"
                onClick={() => setShowPaymentModal(false)}
              >
                Cancel
              </button>
              <button 
                className="modal-button primary"
                onClick={sendPaymentLink}
              >
                Send Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
