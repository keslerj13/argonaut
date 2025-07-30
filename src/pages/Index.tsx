const Index = () => {
  return (
    <div style={{ padding: '20px', backgroundColor: 'white', minHeight: '100vh' }}>
      <h1 style={{ color: 'black', fontSize: '32px', fontWeight: 'bold' }}>
        Hello! CSV Converter Test
      </h1>
      <p style={{ color: 'gray', fontSize: '16px' }}>
        If you can see this text, the basic rendering is working.
      </p>
      <div style={{ 
        border: '2px solid blue', 
        padding: '20px', 
        margin: '20px 0',
        backgroundColor: '#f0f0f0'
      }}>
        <p style={{ color: 'black' }}>This is a test box with inline styles.</p>
      </div>
    </div>
  );
};

export default Index;