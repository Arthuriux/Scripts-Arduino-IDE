int sensorPin = A0;  // Pin del sensor analógico
int sensorValue = 0;  // Variable para almacenar el valor del sensor
float Vin = 0;  // Variable para almacenar el voltaje calculado
float Vmax = 5;  // Voltaje máximo (4.8V en este caso)

void setup() {
  // Inicializar pines del 9 al 13 como salidas para los LEDs
  for (int x = 9; x <= 13; x++) {
    pinMode(x, OUTPUT);
  }
  
  Serial.begin(9600);  // Inicializar comunicación serial a 9600 bps
}

void loop() {
  // Leer el valor del sensor
  sensorValue = analogRead(sensorPin);
  
  // Calcular el voltaje de entrada en base al valor del sensor y la referencia máxima
  Vin = (sensorValue * Vmax) / 1023.0;
  
  // Mostrar el valor del sensor y el voltaje en el puerto serie
  Serial.print("Sensor = ");
  Serial.print(sensorValue);
  Serial.print(", Voltaje de entrada = ");
  Serial.println(Vin, 2);  // Muestra el voltaje con 2 decimales
  
  // Encender los LEDs según el nivel de voltaje medido
  for (int x = 9; x <= 13; x++) {
    if (Vin >= Vmax * (x - 8) / 5 && Vin < Vmax * (x - 7) / 5) {
        digitalWrite(x, HIGH);  // Enciende el LED correspondiente al rango de voltaje
    } else {
        digitalWrite(x, LOW);   // Apaga el LED
    }
}
  
  delay(100);  // Esperar 1 segundo antes de realizar la próxima lectura
}
