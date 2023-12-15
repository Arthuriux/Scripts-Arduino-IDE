#include <DHT.h>
#include <Wire.h> 
#include <LiquidCrystal_I2C.h>
#define DHTPIN 6
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);  // Dirección I2C: 0x27, 16 columnas y 2 filas
const int whiteLed = 7;
const int greenLed = 8;
const int redLed = 9;
const int pinTransmit = 10;
void setup() {
  Serial.begin(9600);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.begin(16, 2);
  pinMode(whiteLed, OUTPUT);
  pinMode(greenLed, OUTPUT);
  pinMode(redLed, OUTPUT);
  pinMode(pinTransmit, OUTPUT);
  delay(1000);
}
void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read from DHT sensor!");
    return;
  }
  int temperature = round(t);
  int humidity = round(h);
  // Enviar inicio de transmisión
  enviarBit(0);
  // Enviar el primer valor
  enviarValor(temperature);
  // Enviar el segundo valor
  enviarValor(humidity);
  // Enviar final de transmisión
  enviarBit(1);
  Serial.print("Enviado temp1: ");
  Serial.println(temperature);
  Serial.print("Enviado hum1: ");
  Serial.println(humidity);
  lcd.setCursor(0,0);
  lcd.print("T: ");
  lcd.print(temperature);
  lcd.print("  ,H: ");
  lcd.print(humidity);
  lcd.print("%");
  digitalWrite(whiteLed, LOW);
  digitalWrite(greenLed, LOW);
  digitalWrite(redLed, LOW);
  if (t < 18.0) {
      digitalWrite(whiteLed, HIGH);
    } else if (t >= 18.0 && t <= 22.0) {
      digitalWrite(greenLed, HIGH);
    } else {
      digitalWrite(redLed, HIGH);
    }
  delay(1000); // Esperar un segundo antes de enviar el siguiente conjunto de números
}
void enviarValor(int valor) {
  // Enviar 8 bits de datos
  for (int i = 0; i < 8; i++) {
    enviarBit((valor >> i) & 1);
  }
}
void enviarBit(int bit) {
  // Enviar el bit
  digitalWrite(pinTransmit, bit);
  delayMicroseconds(100);
}